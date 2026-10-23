# ADR-0001: Licensify — primitivas de licenciamiento local/offline

- **Estado:** Aceptado
- **Fecha:** 2026-10-23
- **Repositorio:** `github.com/AlessandroKlein/Licensify`

## Contexto

El proyecto Webs (github.com/AlessandroKlein/Webs) necesita licenciar plugins
comerciales **sin servidor externo**, con clave de activación ligada a máquina y
protección contra ingeniería inversa. Esto está decidido en
**ADR-0007** del repo Webs (`docs/adr/0007-licensing.md`).

## Decisión

Licensify es un monorepo `pnpm` con dos paquetes publicables:

- **`@licensify/core`** — primitivas criptográficas y de licenciamiento, **sin
  dependencias en runtime** (solo `node:*`). Firma Ed25519, cifrado
  AES-256-GCM con split-key, fingerprint de nodo, claves de activación
  Crockford Base32, anti-tamper y anti-reloj.
- **`@licensify/cli`** — CLI del vendor (offline) para generar claves, firmar y
  emitir/verificar claves de activación.

Se elige **Ed25519** (firma corta, verificación rápida, primitiva nativa de
`node:crypto`) y **AES-256-GCM** (cifrado autenticado, reutiliza el patrón
`iv.tag.ciphertext` de Webs `crypto.ts`). El node-locking usa un fingerprint
**hasheado** (nunca el identificador crudo).

## Consecuencias

- Sin dependencias en runtime → superficie de ataque de supply-chain mínima.
- El formato de clave (layout v1) y el flujo se especifican en
  `docs/activation-key-format.md`.
- **Límite honesto**: la protección en cliente es probabilística, no absoluta;
  se documenta explícitamente para no prometer inviolabilidad.
- La integración en Webs (módulo `apps/api/src/modules/licenses/`) es una tarea
  separada; este repo entrega la biblioteca consumible.
