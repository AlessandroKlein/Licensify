# Security Policy

## Modelo de amenaza y alcance

Licensify ofrece licenciamiento **local/offline**: firma Ed25519 no
falsificable, node-locking por fingerprint y defensa en profundidad contra
ingeniería inversa (AES-256-GCM + split-key, anti-tamper, anti-reloj).

**Límite honesto.** Cualquier verificación que corre íntegramente en el cliente
puede ser vencida por un atacante con recursos (patching, hooking, extracción
de claves, emulación del fingerprint). Licensify **no promete inviolabilidad**:
promete elevar el coste del atacante y garantizar la autenticidad de la
licencia. Para funcionalidad crítica, combina estos checks con controles
server-side cuando sea viable.

## Custodia de la clave privada

- La **clave privada Ed25519** firma licencias. Una filtración permite emitir
  licencias arbitrarias.
- Custódiala fuera del repositorio público (variable de entorno, gestor de
  secretos o HSM). Nunca la commitees.
- El CLI (`licensify`) admite `env:NAME` para no escribir la privada a disco.
- Para rotación de claves, incluye un `keyId` en el `LicensePayload` y verifica
  el `keyId` además de la firma.

## Prácticas implementadas

- **Firma determinista** sobre JSON canónico (claves ordenadas), no sobre la
  serialización cruda.
- **Cifrado autenticado** (AES-256-GCM): cualquier bit alterado falla el auth tag.
- **SALT/IV aleatorios por clave**: no hay texto cifrado correlacionable.
- **Comparación en tiempo constante** de secretos (`secureCompare`,
  `timingSafeEqual`).
- **Fingerprint hasheado** (`SHA-256`): nunca se persiste el identificador crudo
  de hardware.
- **Sin dependencias en runtime**: solo módulos `node:*` incorporados.

## Reportar una vulnerabilidad

**No abras un issue o discusión público.**

Envía los detalles en privado a: **aleklein23@gmail.com**

Incluye:
- Descripción del problema.
- Pasos para reproducirlo o archivos afectados.
- Impacto potencial y mitigación sugerida (opcional).

## Qué esperar

- Acuse de recibo en **7 días**.
- Coordinación de una corrección y un aviso (advisory) cuando proceda.
- No se ofrece bug bounty.

## Versiones soportadas

| Versión | Soportada |
| ------- | --------- |
| 0.1.x   | ✅        |

Las versiones anteriores a `0.1.0` (estado placeholder del repo) no están
soportadas.
