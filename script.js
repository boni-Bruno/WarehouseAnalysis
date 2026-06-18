/* ============================================================
   Armazém Tracker - Tribal Wars
   v1.0.0
   ------------------------------------------------------------
   Lê todas as aldeias da conta e mostra:
   aldeia | pontos | armazém (tamanho e nível) | tempo até encher | data/hora que enche

   Fontes de dados (lidas diretamente do jogo, sem suposições):
   - screen=overview_villages&mode=prod      -> aldeia, pontos, recursos atuais, capacidade do armazém
   - screen=overview_villages&mode=buildings -> nível do armazém (coluna b_storage)
   - screen=overview (por aldeia)            -> produção/hora real de cada recurso (data-title do header),
                                                  já incluindo todos os bônus (item de paladino, aldeia-bônus, etc.)

   Uso (quick bar):
   javascript:$.getScript('https://boni-bruno.github.io/AtackPlanner/armazem.js');
   ============================================================ */

(function () {
    'use strict';

    const VERSION = '1.0.0';

    if (typeof game_data === 'undefined') {
        alert('Armazém Tracker precisa ser executado dentro do Tribal Wars.');
        return;
    }

    // Remove instância anterior, se houver (evita duplicar ao rodar de novo pela quick bar)
    $('#wh-tracker-overlay').remove();

    // ---------- helpers ----------

    function pad(n) { return String(n).padStart(2, '0'); }

    function parseNum(text) {
        return parseInt(String(text).replace(/[^\d-]/g, ''), 10) || 0;
    }

    function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    function villageUrl(id, screen) {
        return location.pathname + '?village=' + id + '&screen=' + screen;
    }

    // Offset entre hora do servidor (mostrada no rodapé do jogo) e hora do navegador,
    // pra garantir que "data/hora que enche" seja calculada a partir do tempo certo.
    function getServerOffset() {
        try {
            const t = $('#serverTime').text().trim();   // HH:MM:SS
            const d = $('#serverDate').text().trim();    // DD/MM/AAAA
            const [hh, mm, ss] = t.split(':').map(Number);
            const [dd, mo, yy] = d.split('/').map(Number);
            const serverNow = new Date(yy, mo - 1, dd, hh, mm, ss).getTime();
            return serverNow - Date.now();
        } catch (e) {
            return 0;
        }
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
        const date = new Date(ms);
        return 'em ' + pad(date.getDate()) + '.' + pad(date.getMonth() + 1) +
            '. às ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
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

        // 1) screen=overview_villages&mode=prod -> aldeia, pontos, recursos, capacidade do armazém
        const prodHtml = await $.get(villageUrl(myId, 'overview_villages') + '&mode=prod&group=0');
        const $prod = $('<div>').html(prodHtml);

        $prod.find('#production_table > tbody > tr').each(function () {
            const $row = $(this);
            const id = $row.find('.quickedit-vn').data('id');
            if (!id) return;

            const name = $row.find('.quickedit-label').text().trim().replace(/\s+/g, ' ');
            const $tds = $row.find('td');
            const points = parseNum($tds.eq(2).text());
            const resCell = $tds.eq(3);
            const wood = parseNum(resCell.find('span.wood').text());
            const stone = parseNum(resCell.find('span.stone').text());
            const iron = parseNum(resCell.find('span.iron').text());
            const storageMax = parseNum($tds.eq(4).text());

            villages[id] = {
                id, name, points, wood, stone, iron, storageMax,
                level: null, rateWood: 0, rateStone: 0, rateIron: 0
            };
        });

        // 2) screen=overview_villages&mode=buildings -> nível do armazém
        $status.text('Lendo níveis de armazém...');
        const buildHtml = await $.get(villageUrl(myId, 'overview_villages') + '&mode=buildings&group=0');
        const $build = $('<div>').html(buildHtml);

        $build.find('#buildings_table tr[id^="v_"]').each(function () {
            const $row = $(this);
            const id = $row.find('.quickedit-vn').data('id');
            if (!id || !villages[id]) return;
            villages[id].level = parseNum($row.find('td.upgrade_building.b_storage').text());
        });

        // 3) produção real por hora, aldeia por aldeia (com pequeno delay entre requisições)
        const ids = Object.keys(villages);
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            $status.text('Lendo produção: aldeia ' + (i + 1) + ' de ' + ids.length + '...');

            try {
                const pageHtml = await $.get(villageUrl(id, 'overview'));
                const $doc = $('<div>').html(pageHtml);

                const grab = title => {
                    const m = String(title || '').replace(/\./g, '').match(/(\d+)\s*por hora/);
                    return m ? parseInt(m[1], 10) : 0;
                };

                villages[id].rateWood = grab($doc.find('#wood').attr('data-title'));
                villages[id].rateStone = grab($doc.find('#stone').attr('data-title'));
                villages[id].rateIron = grab($doc.find('#iron').attr('data-title'));

                // recursos mais recentes (mesma leitura da produção, evita defasagem)
                villages[id].wood = parseNum($doc.find('#wood').text());
                villages[id].stone = parseNum($doc.find('#stone').text());
                villages[id].iron = parseNum($doc.find('#iron').text());
            } catch (e) {
                // se uma aldeia falhar, segue pras outras (essa fica sem tempo calculado)
            }

            await sleep(300);
        }

        // 4) calcula tempo até encher (pelo recurso que enche primeiro)
        const list = Object.values(villages).map(v => {
            const timeFor = (cur, rate) => {
                if (rate <= 0) return Infinity;
                const remaining = Math.max(0, v.storageMax - cur);
                return remaining / rate * 3600;
            };
            v.timeSec = Math.min(
                timeFor(v.wood, v.rateWood),
                timeFor(v.stone, v.rateStone),
                timeFor(v.iron, v.rateIron)
            );
            return v;
        });

        list.sort((a, b) => a.timeSec - b.timeSec);

        // 5) renderiza
        $tbody.empty();
        const nowMs = now();
        list.forEach(v => {
            const fullAt = isFinite(v.timeSec) ? nowMs + v.timeSec * 1000 : Infinity;
            $tbody.append(`<tr>
                <td style="border:1px solid #c8a45e;padding:4px;">${v.name}</td>
                <td style="border:1px solid #c8a45e;padding:4px;text-align:right;">${v.points.toLocaleString('pt-BR')}</td>
                <td style="border:1px solid #c8a45e;padding:4px;text-align:right;">${v.storageMax.toLocaleString('pt-BR')} (Nível ${v.level})</td>
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
