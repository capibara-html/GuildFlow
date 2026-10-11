// Verificación del fixture: allowed/target.txt debe contener exactamente "OK-ARTIFICE".
// Vive fuera de allowed/ para que el Artífice no pueda reescribir su propio examen.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const target = fileURLToPath(new URL('../allowed/target.txt', import.meta.url))
const text = readFileSync(target, 'utf8').trim()
const ok = text === 'OK-ARTIFICE'
console.log(JSON.stringify({ test: 'target-content', expected: 'OK-ARTIFICE', got: text, pass: ok }))
console.log(`tests: 1, passed: ${ok ? 1 : 0}`)
process.exit(ok ? 0 : 1)
