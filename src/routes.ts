import { Hono } from 'hono';
import { runScenario } from './calc/fire';
import { validateAndClampInputs } from './validate';

// No cors() middleware: static assets and API are served by the same Worker,
// so all requests are same-origin and no CORS headers are needed.
const app = new Hono();

app.post('/api/calculate', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const validated = validateAndClampInputs(raw);
  if (!validated.ok) {
    return c.json({ error: validated.error }, 400);
  }

  const result = runScenario(validated.inputs);
  return c.json(result);
});

export default app;
