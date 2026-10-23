# Licensify

Software licensing **local, offline y anti-reverse-engineering**. Sin servidor
de licencias, sin llamadas de red en runtime: licencias firmadas con
**Ed25519**, activación por **clave de activación** ligada a la máquina
(**node-locking** por fingerprint de hardware), y defensa en profundidad contra
ingeniería inversa (**AES-256-GCM + split-key, anti-tamper y anti-reloj**).

> ⚠️ **Límite honesto.** Toda verificación que corre 100 % en el cliente puede ser
> vencida por un atacante con recursos. Licensify **no promete inviolabilidad**;
> promete (1) licencias **no falsificables** (firma Ed25519), (2) ligadas a
> máquina (fingerprint), y (3) un **coste de ingeniería inversa alto** con varias
> capas independientes. Para funcionalidad crítica, combínalo con checks
> server-side cuando sea viable.

---

## Paquetes

Monorepo `pnpm` con dos paquetes publicables:

| Paquete          | Descripción                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| `@licensify/core` | Biblioteca TypeScript sin dependencias en runtime (solo `node:*` built-ins). |
| `@licensify/cli`  | CLI del vendor para emitir licencias y claves de activación offline.        |

---

## Instalación

```bash
# Consumir la biblioteca (en el backend/plugin que verifica licencias):
npm install @licensify/core

# Usar el CLI del vendor (para emitir licencias):
npm install -g @licensify/cli
```

`@licensify/core` expone builds **ESM** (`import`), **CJS** (`require`) y tipos
`.d.ts`. Requiere **Node ≥ 18**.

---

## Uso rápido — CLI del vendor

El CLI nunca necesita escribir la clave privada a disco: se puede pasar por
variable de entorno con `env:NAME`.

```bash
# 1. Generar el par de claves Ed25519 del vendor (custodia la privada en secreto).
licensify keygen --out ./keys
#   -> ./keys/licensify.public.pem
#   -> ./keys/licensify.private.pem

# 2. Imprimir el fingerprint de la máquina destino (para node-locking).
licensify fingerprint
#   -> be2f392d... (64 hex)

# 3. Emitir una clave de activación ligada a ese fingerprint.
licensify issue \
  --private-key ./keys/licensify.private.pem \
  --payload '{"id":"l-0001","productId":"plugin-x","licensee":"ACME","features":["pro","reports"],"issuedAt":"2026-01-01T00:00:00Z","expiresAt":"2027-01-01T00:00:00Z"}' \
  --fingerprint be2f392d...

# 4. Activar (offline) en la máquina destino.
licensify activate \
  --public-key ./keys/licensify.public.pem \
  --activation-key '9H9MWHG1EJ4...'
#   -> Activation VALID  (imprime el payload)
```

Otros comandos: `sign` (firmar un payload → `SignedLicense`), `verify`
(verificar una licencia firmada), `fingerprint --salt --extra`.

---

## Uso rápido — API de `@licensify/core`

```ts
import {
  generateKeyPair,
  createActivationKey,
  verifyActivationKey,
  getFingerprint,
} from "@licensify/core";

// ---- Vendor (offline) ----
const { publicKeyPem, privateKeyPem } = generateKeyPair();

const activationKey = createActivationKey(
  {
    id: "l-0001",
    productId: "plugin-x",
    licensee: "ACME",
    features: ["pro"],
    issuedAt: new Date().toISOString(),
    expiresAt: "2027-01-01T00:00:00Z",
  },
  {
    privateKeyPem,
    fingerprint: "<fingerprint de la máquina destino>",
  },
);

// ---- Consumidor (offline, en la máquina destino) ----
const fingerprint = getFingerprint(); // mismo hardware => mismo hash
const result = verifyActivationKey(activationKey, { publicKeyPem, fingerprint });
console.log(result.payload.features); // ["pro"]
```

La verificación completa es: **decodificar → descifrar (ligado al fingerprint)
→ verificar firma Ed25519 → comprobar expiración**. Si la clave se copia a otra
máquina, el descifrado falla (`InvalidActivationKeyError`).

### API por dominio

| Dominio          | Exportaciones                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| Firma (Ed25519)  | `generateKeyPair`, `signEd25519`, `verifyEd25519`                                                   |
| Cifrado (AES-GCM)| `deriveKey`, `splitKey`, `combineKey`, `encryptAesGcm*`, `decryptAesGcm*`, `serializeEncrypted`, `parseEncrypted` |
| Fingerprint      | `getFingerprint`, `fingerprintToBytes`, `deriveFingerprintKey`                                      |
| Licencia firmada | `signLicense`, `verifyLicenseSignature`, `isLicenseExpired`, `assertNotExpired`, `parseSignedLicense`, `stringifySignedLicense` |
| Clave activación | `createActivationKey`, `createActivationKeyFromSigned`, `parseActivationKey`, `verifyActivationKey`, `decryptActivationKeyForIssuer` |
| Anti-tamper      | `hashSection`, `TamperGuard`                                                                         |
| Anti-reloj       | `monotonicNowMs`, `ClockGuard`, `MemoryClockStore`, `FileClockStore`                                |
| Codificación     | `crockfordBase32Encode/Decode`, `stableStringify`, `sha256`, `sha256Hex`, `secureCompare`, `base64UrlEncode/Decode` |

Errores tipados: `LicensifyError`, `InvalidActivationKeyError`,
`DecryptionError`, `SignatureVerificationError`, `LicenseExpiredError`,
`FingerprintMismatchError`, `ClockRollbackError`, `TamperError`.

---

## Modelo de licencia

```ts
interface LicensePayload {
  id: string;              // licencia única
  productId: string;       // plugin/producto licenciado
  licensee: string;        // titular
  features?: string[];     // capacidades habilitadas
  limits?: Record<string, number>;
  issuedAt: string;        // ISO-8601
  expiresAt?: string;      // ISO-8601 (ausente = perpetua)
}

interface SignedLicense {
  v: 1;
  payload: LicensePayload;
  signature: string;       // Ed25519 sobre el payload canónico, base64url
}
```

El payload se **canonicaliza** (JSON con claves ordenadas recursivamente) antes
de firmar, de modo que la firma es determinista e independiente del orden de
las claves.

---

## Formato de la clave de activación

La clave de activación es una cadena **Crockford Base32** (sin padding, sin
caracteres ambiguos `I`/`L`/`O`/`U`) que codifica un blob binario **v1**:

```
MAGIC "LSNF" (4B) | VERSION 0x01 (1B) | SALT (16B) | IV (12B) | CIPHERTEXT | TAG (16B)
```

- `SALT` + `IV` son aleatorios por clave.
- La clave AES es `SHA-256(fingerprint_bytes(32) || SALT)`: **node-locked**.
- El `CIPHERTEXT` es AES-256-GCM del JSON canónico del `SignedLicense`.

Especificación completa (layout byte a byte, algoritmo, flujo emisión →
activación, y consideraciones de seguridad): véase
[`docs/activation-key-format.md`](docs/activation-key-format.md).

---

## Node-locking (fingerprint)

El fingerprint es un `SHA-256` (64 hex) de señales hardware/OS, **nunca el dato
crudo**: `machine-id` (Linux/macOS) / `MachineGuid` (Windows), MACs, hostname,
plataforma, arquitectura, versión del kernel y modelo de CPU. Solo el hash se
persiste o transmite.

- Estable entre reinicios, determinista en una misma máquina.
- Refuerzo opcional vía `extraSignals` (p. ej. serial de disco que provea la app
  host) y `salt` para hacerlo específico por vendor/producto.
- `deriveFingerprintKey(fingerprint, salt)` deriva la clave AES de 32 bytes.

---

## Anti-reverse-engineering (defensa en profundidad)

1. **Integridad + firma** — `sha256` + Ed25519: cualquier manipulación de la
   licencia invalida la firma.
2. **Cifrado** — AES-256-GCM sobre el payload activado (formato
   `iv.tag.ciphertext`, compatible con el patrón de Webs `crypto.ts`).
3. **Clave partida (split-key)** — la clave se divide en dos partes XOR-adas
   (`splitKey`/`combineKey`) para evitar una única constante contigua.
4. **Anti-tamper** — `TamperGuard`/`hashSection` verifican el hash (HMAC opcional)
   de una sección crítica de código en runtime.
5. **Anti-reloj** — `ClockGuard` combina reloj monotónico + timestamp persistido
   (`FileClockStore`) y detecta retrocesos del reloj del sistema.
6. **Ofuscación (build step)** — opcional; aplicar un ofuscador solo a la rutina
   de verificación (no incluido en este repo para mantener la depurabilidad).
7. **Anti-debug (opcional)** — detección best-effort de debugger/instrumentación.

Ninguna de estas capas es matemáticamente absoluta; su objetivo es elevar el
coste del atacante, no eliminarlo.

---

## Custodia de la clave privada

- La **clave privada Ed25519** firma licencias. Si se filtra, se pueden emitir
  licencias falsas: custódiala fuera del repositorio (variable de entorno / HSM).
- Rotación: incluye un `keyId` en el payload si necesitas rotar claves del vendor.
- El CLI soporta `env:NAME` para no escribir nunca la privada a disco.

---

## Relación con Webs

Este repo materializa **ADR-0007** del proyecto
[Webs](https://github.com/AlessandroKlein/Webs) (`docs/adr/0007-licensing.md`).
La integración en Webs (módulo `apps/api/src/modules/licenses/` y los campos
`commercial`/`productId` del manifiesto de plugin) es **otra tarea**; este repo
solo entrega la biblioteca y el CLI consumibles.

---

## Desarrollo

```bash
pnpm install
pnpm run typecheck   # tsc --noEmit en core y cli
pnpm run build       # tsup: core (ESM+CJS+dts) y cli (ESM)
pnpm run test        # vitest (47 tests)
```

Cero dependencias en runtime (`node:crypto`, `node:os`, `node:fs`, `node:path`,
`node:child_process`, `node:perf_hooks`). Dev deps: `typescript`, `tsup`,
`vitest`, `@types/node`.

## Seguridad

Véase [`SECURITY.md`](SECURITY.md).

## Licencia

MIT — véase [`LICENSE`](LICENSE).
