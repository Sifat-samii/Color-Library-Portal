# js-sha256

Unmodified `src/sha256.js` from **js-sha256 v0.11.1**, MIT licensed.

- Source: https://github.com/emn178/js-sha256/tree/v0.11.1
- SHA-256: `2db6c8e554fbee14672368a0d7551a8ddd841ee96c91526eb7987a0179cfc717`
- License: [js-sha256-LICENSE.txt](js-sha256-LICENSE.txt)

Used through its incremental `create().update()` interface because the tested Photoshop 25.3.1 UXP runtime lacks Node crypto and Web Crypto digest. No install hooks or network service are required. Node tests compare multi-chunk file digests with Node's independent crypto implementation; native fixtures verify UXP file reads.
