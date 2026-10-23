# Formato de la clave de activación (offline)

Este documento especifica el formato binario y el flujo de la **clave de
activación** de Licensify, tal como lo implementa `@licensify/core`
(`packages/core/src/activation-key.ts`).

## Resumen

La clave de activación es una cadena corta, apta para teclear y sin caracteres
ambiguos, que **cifra** una licencia ya firmada y la **liga a una máquina**
concreta. No hay llamada a servidor: toda la validación es local.

La clave final es **Crockford Base32** (sin padding) del blob binario descrito
abajo.

## Alfabeto

Crockford Base32 usa el alfabeto `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (32
símbolos, sin `I`, `L`, `O` ni `U` para evitar confusiones).

- Codificación: sin padding, mayúsculas.
- Decodificación: tolerante — acepta minúsculas, guiones, espacios, `=` y
  normaliza `O/o → 0`, `I/i/L/l → 1`.

## Layout binario (versión 1)

Byte a byte, en orden:

| Campo        | Tamaño | Contenido                                                        |
| ------------ | ------ | ---------------------------------------------------------------- |
| `MAGIC`      | 4 B    | ASCII `"LSNF"` (`0x4C 0x53 0x4E 0x46`)                            |
| `VERSION`    | 1 B    | `0x01`                                                           |
| `SALT`       | 16 B   | Aleatorio por clave (mezclado con el fingerprint para derivar la clave) |
| `IV`         | 12 B   | Nonce aleatorio AES-GCM                                          |
| `CIPHERTEXT` | var    | AES-256-GCM del JSON canónico del `SignedLicense`                |
| `TAG`        | 16 B   | Auth tag AES-GCM                                                 |

Tamaño mínimo del blob: `4 + 1 + 16 + 12 + 0 + 16 = 49` bytes.

## Derivación de la clave (node-locking)

```
key = SHA-256( fingerprint_bytes(32) || SALT )
```

- `fingerprint_bytes(32)` = los 32 bytes crudos del fingerprint hex (64 chars)
  de la máquina (`fingerprintToBytes`).
- `SALT` = los 16 bytes aleatorios del blob.

Por tanto, la clave AES **solo** se puede reconstruir en la máquina cuyo
fingerprint se usó al emitirla. Copiar la clave a otra máquina produce un fallo
de autenticación GCM en el descifrado (`InvalidActivationKeyError`).

## Cifrado

- Algoritmo: **AES-256-GCM**.
- `IV` de 12 bytes, auth tag de 16 bytes.
- El plaintext es `stableStringify(signedLicense)` (JSON con claves ordenadas
  recursivamente, UTF-8).

## Contenido cifrado (plaintext)

El plaintext es la representación canónica de un `SignedLicense`:

```ts
interface SignedLicense {
  v: 1;
  payload: LicensePayload;   // { id, productId, licensee, features?, limits?, issuedAt, expiresAt? }
  signature: string;         // Ed25519 sobre el payload canónico, base64url
}
```

La **firma Ed25519** se verifica **después** del descifrado, con la clave
pública del vendor embebida en el consumidor.

## Flujo completo

### Emisión (vendor, offline)

1. El vendor genera el par Ed25519 una vez (`generateKeyPair`); custodia la
   privada en secreto.
2. Obtiene el fingerprint hex de la máquina destino (lo provee el cliente o se
   calcula en el host de despliegue).
3. `createActivationKey(payload, { privateKeyPem, fingerprint })`:
   1. `signLicense(payload, privateKey)` → `SignedLicense`.
   2. `salt = randomBytes(16)`, `iv = randomBytes(12)`.
   3. `key = deriveFingerprintKey(fingerprint, salt)`.
   4. `ciphertext, tag = AES-256-GCM(stableStringify(signed), key, iv)`.
   5. `blob = MAGIC || VERSION || salt || iv || ciphertext || tag`.
   6. Devuelve `crockfordBase32Encode(blob)`.

### Activación (consumidor, offline)

1. `parseActivationKey(key)` decodifica y trocea el blob; valida `MAGIC` y
   `VERSION`.
2. `deriveFingerprintKey(fingerprintLocal, salt)` reconstruye la clave.
3. Descifra el `SignedLicense` (falla en otra máquina).
4. `verifyLicenseSignature(signed, publicKeyPem)` — detecta manipulación.
5. `assertNotExpired(payload, now)` — detecta expiración.
6. Devuelve `ActivationResult` con el payload validado.

## Manejo de errores

| Situación                                   | Error lanzado                       |
| ------------------------------------------- | ----------------------------------- |
| Cadena malformada / Base32 inválida         | `InvalidActivationKeyError`         |
| `MAGIC` o `VERSION` desconocidos            | `InvalidActivationKeyError`         |
| Descifrado falla (otra máquina / alterado)  | `InvalidActivationKeyError`         |
| Firma no coincide (payload manipulado)      | `SignatureVerificationError`        |
| Licencia expirada                           | `LicenseExpiredError`               |

## Consideraciones de seguridad

- **Node-locking honesto**: el fingerprint es un hash de señales que el usuario
  puede, en principio, reproducir o suplantar; eleva el coste, no lo elimina.
- **`SALT` e `IV` aleatorios por clave**: dos claves del mismo payload y
  fingerprint son distintas (no se puede correlacionar por texto cifrado).
- **La firma va dentro del cifrado**: el atacante primero debe descifrar (o
  forzar el GCM) antes de siquiera ver el payload firmado.
- **Límite declarado**: cualquier verificación 100 % en cliente es vencible por
  un atacante con recursos. La protección más fuerte combina esto con checks
  server-side cuando sea viable.

## Versiones

Solo existe la versión `1`. Si en el futuro se cambia el layout, se incrementa
`VERSION` y el decodificador rechaza versiones desconocidas
(`Unsupported activation-key version`).
