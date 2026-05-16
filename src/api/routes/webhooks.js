const express = require('express');
const router = express.Router();
const pool = require('../../config/database');

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// POST /webhooks — registrar endpoint para notificações
router.post('/', async (req, res) => {
  const { url, evento = 'vencimento', min_dias = 30 } = req.body;

  if (!url) return res.status(400).json({ error: 'Informe o campo url' });
  if (!isValidUrl(url)) return res.status(400).json({ error: 'url inválida — deve ser http:// ou https://' });

  const dias = parseInt(min_dias, 10);
  if (isNaN(dias) || dias < 1 || dias > 3650) {
    return res.status(400).json({ error: 'min_dias deve ser entre 1 e 3650' });
  }

  const eventosValidos = ['vencimento'];
  if (!eventosValidos.includes(evento)) {
    return res.status(400).json({ error: `evento inválido — use: ${eventosValidos.join(', ')}` });
  }

  try {
    const result = await pool.query(
      `INSERT INTO webhooks (url, evento, min_dias) VALUES ($1, $2, $3) RETURNING *`,
      [url, evento, dias]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro em POST /webhooks:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /webhooks — listar webhooks ativos
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM webhooks WHERE ativo = TRUE ORDER BY criado_em DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em GET /webhooks:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /webhooks/:id — desativar webhook
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      'UPDATE webhooks SET ativo = FALSE WHERE id = $1 AND ativo = TRUE RETURNING id',
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Webhook não encontrado' });
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Erro em DELETE /webhooks/:id:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
