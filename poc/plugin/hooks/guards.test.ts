import { expect, test } from 'claude-code/testing'

// run_check solo ejecuta identificadores de su tabla: una cadena con un comando encadenado se rechaza
// en el hook (el enum del inputSchema no lo aplica el motor; lo vimos en la PoC).
test('run_check rechaza un identificador fuera de la lista blanca', async $ => {
  const r = (await $.tool.call({ tool: 'mcp__guildflow-poc__run_check', check: 'fixture-test; del control.txt' } as never)) as {
    deny?: string
    text?: string
  }
  expect(r.deny ?? r.text ?? '').toContain('comprobación desconocida')
})

// Fallo seguro: si el rol de un agente no puede resolverse ($.agent.list no responde), la guarda
// lanza y su .catch rechaza la operación en lugar de dejarla pasar.
test('un agente cuyo rol no puede resolverse se rechaza (fallo en cerrado)', async $ => {
  const r = (await $.tool.call({ tool: 'Write', file_path: 'C:/tmp/x.txt', content: 'x', agentId: 'agente-desconocido' } as never)) as {
    deny?: string
    text?: string
  }
  expect(r.deny ?? r.text ?? '').toContain('se rechaza por seguridad')
})
