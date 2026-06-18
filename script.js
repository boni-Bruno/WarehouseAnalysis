/* ============================================================
   Armazém Tracker - Tribal Wars
   v1.4.0
   ------------------------------------------------------------
   v1.4.0: volta pra $.get (confirmado funcionar via diagnóstico).
   Extração de produção/hora via regex direto no HTML (sem
   parsear o JSON inteiro, que quebrava por detalhe de formato).
   wood_prod/stone_prod/iron_prod estão em unidades/segundo no
   game_data; × 3600 = por hora. Também extrai nível do armazém
   do bloco "buildings" do game_data.
   ------------------------------------------------------------
   Lê todas as aldeias da conta e mostra:
   aldeia | pontos | armazém (tamanho e nível) | tempo até encher | data/hora que enche

   Uso (quick bar):
   javascript:$.getScript('https://boni-bruno.github.io/AtackPlanner/armazem.js');
   ============================================================ */

(function () {
    'use strict';

    const VERSION = '1.4.0';

    if (typeof game_data === 'undefined') {
        alert('Armazém Tracker precisa ser executado dentro do Tribal Wars.');
        return;
    }

    $('#wh-tracker-overlay').remove();

    // ---------- helpers ----------

    function pad(n) { return String(n).padStart(2, '0'); }

    function parseNum(text) {
        return parseInt(String(text).replace(/[^\d-]/g, ''), 10) || 0;
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function villageUrl(id, screen) {
        return location.pathname + '?village=' + id + '&screen=' + screen;
    }

    // Extrai um campo numérico direto do HTML bruto, sem parsear JSON inteiro.
    // Exemplo: extractFloat(html, 'wood_prod') → 1.2000000133361
    function extractFloat(html, field) {
        const re = new RegExp('"' + field + '"\\s*:\\s*([\\d.eE+-]+)');
        const m = html.match(re);
        return m ? parseFloat(m[1]) : 0;
    }

    // Extrai o nível do armazém do bloco "buildings":{..."storage":"N"...}
    function extractStorageLevel(html) {
        const m = html.match(/"buildings"\s*:\s*\{[^}]*?"storage"\s*:\s*"?(\d+)"?/);
        return m ? parseInt(m[1], 10) : null;
    }

    function getServerOffset() {
        try {
            const t = $('#serverTime').text().trim();
            const d = $('#serverDate').text().trim();
            const [hh, mm, ss] = t.split(':').map(Number);
            const [dd, mo, yy] = d.split('/').map(Number);
            return new Date(yy, mo - 1, dd, hh, mm, ss).getTime() - Date.now();
        } catch (e) { return 0; }
    }
    const SERVER_OFFSET = getServerOffset();
    function now() { return Date.now() + SERVER_OFFSET; }

    function fmtDuration(totalSeconds) {
        if (!isFinite(totalSeconds)) return '—';
        totalSeconds = Math.max(0, Math.round(totalSeconds));
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        return pad(h) + ':' + pad(m) + ':' + pad(s);
    }

    function fmtDateTime(ms) {
        if (!isFinite(ms)) return '—';
        const d = new Date(ms);
        return 'em ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) +
            '. às ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    // ---------- UI ----------

    const html = `
    <div id="wh-tracker-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:Verdana,sans-serif;">
      <div style="background:#e3d5b4;border:3px solid #7d510f;border-radius:6px;width:940px;max-height:85vh;display:flex;flex-direction:column;">
        <div style="background:#7d510f;color:#fff0d6;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-radius:4px 4px 0 0;">
          <strong>Armazém Tracker v${VERSION}</strong>
          <span id="wh-close" style="cursor:pointer;font-weight:bold;padding:0 4px;">✕</span>
        </div>
        <div style="padding:10px 12px;overflow:auto;flex:1;font-size:12px;color:#3a2a14;">
          <div style="margin-bottom:8px;">
            <button id="wh-refresh" style="background:#c8a45e;border:1px solid #7d510f;border-radius:4px;padding:4px 10px;cursor:pointer;font-weight:bold;">Atualizar</button>
            <span id="wh-status" style="margin-left:10px;"></span>
          </div>
          <table width="100%" style="border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:#c8a45e;">
                <th style="border:1px solid #7d510f;padding:4px;text-align:left;">Aldeia</th>
                <th style="border:1px solid #7d510f;padding:4px;">Pontos</th>
                <th style="border:1px solid #7d510f;padding:4px;">Armazém</th>
                <th style="border:1px solid #7d510f;padding:4px;">Tempo até encher</th>
                <th style="border:1px solid #7d510f;padding:4px;">Data/hora que enche</th>
              </tr>
            </thead>
            <tbody id="wh-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>`;

    $('body').append(html);
    $('#wh-close').on('click', () => $('#wh-tracker-overlay').remove());

    // ---------- lógica principal ----------

    async function run() {
        const $status = $('#wh-status');
        const $tbody = $('#wh-tbody');
        $tbody.empty();
        $status.text('Lendo lista de aldeias...');

        const myId = game_data.village.id;
        const villages = {};

        // 1) mode=prod → lista de aldeias, pontos, recursos atuais, capacidade do armazém
        const prodHtml = await $.get(villageUrl(myId, 'overview_villages') + '&mode=prod&group=0');
        const prodDoc = new DOMParser().parseFromString(prodHtml, 'text/html');

        prodDoc.querySelectorAll('#production_table > tbody > tr').forEach(row => {
            const $row = $(row);
            const id = $row.find('.quickedit-vn').data('id');
            if (!id) return;
            const name = $row.find('.quickedit-label').text().trim().replace(/\s+/g, ' ');
            const $tds = $row.find('td');
            const points = parseNum($tds.eq(2).text());
            const wood = parseNum($tds.eq(3).find('span.wood').text());
            const stone = parseNum($tds.eq(3).find('span.stone').text());
            const iron = parseNum($tds.eq(3).find('span.iron').text());
            const storageMax = parseNum($tds.eq(4).text());
            villages[id] = { id, name, points, wood, stone, iron, storageMax, level: null, rateWood: 0, rateStone: 0, rateIron: 0 };
        });

        // 2) screen=overview de cada aldeia → extrai wood_prod/stone_prod/iron_prod por regex
        const ids = Object.keys(villages);
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            $status.text('Lendo produção: aldeia ' + (i + 1) + ' de ' + ids.length + '...');
            try {
                const pageHtml = await $.get(villageUrl(id, 'overview'));
                // wood_prod está em unidades/segundo → × 3600 = por hora
                villages[id].rateWood  = extractFloat(pageHtml, 'wood_prod')  * 3600;
                villages[id].rateStone = extractFloat(pageHtml, 'stone_prod') * 3600;
                villages[id].rateIron  = extractFloat(pageHtml, 'iron_prod')  * 3600;
                // recursos mais atualizados (mesma requisição)
                const w = extractFloat(pageHtml, 'wood');
                const s = extractFloat(pageHtml, 'stone');
                const fe = extractFloat(pageHtml, 'iron');
                if (w) villages[id].wood = w;
                if (s) villages[id].stone = s;
                if (fe) villages[id].iron = fe;
                // nível do armazém
                const lv = extractStorageLevel(pageHtml);
                if (lv !== null) villages[id].level = lv;
            } catch (e) {
                console.error('Armazém Tracker: falha lendo aldeia', id, e);
            }
            await sleep(300);
        }

        // 3) calcula tempo até encher (pelo recurso que enche primeiro)
        const list = Object.values(villages).map(v => {
            const timeFor = (cur, rate) => rate > 0 ? Math.max(0, v.storageMax - cur) / rate * 3600 : Infinity;
            v.timeSec = Math.min(
                timeFor(v.wood,  v.rateWood),
                timeFor(v.stone, v.rateStone),
                timeFor(v.iron,  v.rateIron)
            );
            return v;
        });
        list.sort((a, b) => a.timeSec - b.timeSec);

        // 4) renderiza
        $tbody.empty();
        const nowMs = now();
        list.forEach(v => {
            const fullAt = isFinite(v.timeSec) ? nowMs + v.timeSec * 1000 : Infinity;
            $tbody.append(`<tr>
                <td style="border:1px solid #c8a45e;padding:4px;">
                  <a href="${villageUrl(v.id, 'overview')}" style="color:#3a2a14;text-decoration:underline;">${v.name}</a>
                </td>
                <td style="border:1px solid #c8a45e;padding:4px;text-align:right;">${v.points.toLocaleString('pt-BR')}</td>
                <td style="border:1px solid #c8a45e;padding:4px;text-align:right;">${v.storageMax.toLocaleString('pt-BR')} (Nível ${v.level ?? '?'})</td>
                <td style="border:1px solid #c8a45e;padding:4px;text-align:right;">${fmtDuration(v.timeSec)}</td>
                <td style="border:1px solid #c8a45e;padding:4px;">${fmtDateTime(fullAt)}</td>
            </tr>`);
        });

        const n = new Date(nowMs);
        $status.text('Atualizado às ' + pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds()) +
            ' — ' + list.length + ' aldeias.');
    }

    $('#wh-refresh').on('click', run);
    run();

})();
