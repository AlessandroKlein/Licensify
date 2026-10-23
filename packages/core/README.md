# @licensify/core

Biblioteca TypeScript **sin dependencias en runtime** para licenciamiento
local/offline: firma **Ed25519**, cifrado **AES-256-GCM** con clave partida,
**node-locking** por fingerprint de hardware, y **claves de activación**
Crockford Base32. Materializa el ADR-0007 del proyecto Webs.

```bash
npm install @licensify/core
```

```ts
import {
  generateKeyPair,
  createActivationKey,
  verifyActivationKey,
  getFingerprint,
} from "@licensify/core";

const { publicKeyPem, privateKeyPem } = generateKeyPair();

const key = createActivationKey(
  { id: "l1", productId: "p", licensee: "ACME", issuedAt: new Date().toISOString() },
  { privateKeyPem, fingerprint: "<target-machine-fingerprint>" },
);

const result = verifyActivationKey(key, { publicKeyPem, fingerprint: getFingerprint() });
```

Véase el [README raíz](../../README.md) para la documentación completa del
formato de clave, el flujo y la API.
