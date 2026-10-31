// Файл для Cloudflare Pages Functions (положить по пути: functions/api/sync.js)
// Или для отдельного Cloudflare Worker (привязать базу D1 под именем DB)

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

async function handleSync(request, env) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }

    try {
        let userId = 'anon';
        let delta = 0;
        let clientScore = 0;

        if (request.method === 'POST') {
            const body = await request.json();
            userId = String(body.userId || 'anon').slice(0, 64);
            // Защита от автокликеров: максимум 80 кликов за один пакет синхронизации (3 сек)
            const rawDelta = parseInt(body.delta || 0, 10);
            delta = Number.isFinite(rawDelta) ? Math.max(0, Math.min(80, rawDelta)) : 0;
            const rawScore = parseInt(body.score || 0, 10);
            clientScore = Number.isFinite(rawScore) ? Math.max(0, rawScore) : 0;
        }

        if (delta > 0) {
            await env.DB.batch([
                env.DB.prepare(
                    'UPDATE global_state SET total_taps = MIN(1000000, total_taps + ?1) WHERE id = 1'
                ).bind(delta),
                env.DB.prepare(
                    `INSERT INTO users (user_id, score, updated_at)
                     VALUES (?1, ?2, strftime('%s', 'now'))
                     ON CONFLICT(user_id) DO UPDATE SET
                     score = MAX(users.score + ?3, ?2),
                     updated_at = strftime('%s', 'now')`
                ).bind(userId, clientScore, delta)
            ]);
        }

        const row = await env.DB.prepare(
            'SELECT total_taps FROM global_state WHERE id = 1'
        ).first();

        const globalScore = row && typeof row.total_taps === 'number' ? row.total_taps : 0;

        return new Response(JSON.stringify({ ok: true, globalScore }), {
            headers: CORS_HEADERS
        });
    } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
            status: 500,
            headers: CORS_HEADERS
        });
    }
}

// Экспорт для Cloudflare Pages Functions (functions/api/sync.js)
export async function onRequest(context) {
    return handleSync(context.request, context.env);
}

// Экспорт для отдельного Cloudflare Worker
export default {
    async fetch(request, env) {
        return handleSync(request, env);
    }
};
