/* Independent program Gantt. AGPL-3.0-or-later; no external rendering service. */
;(function(global)
{
    'use strict';
    const DAY = 86400000;
    const HEIGHT = 56;
    const HEADER_HEIGHT = 64;
    const COLORS = {program: '#7352bf', project: '#2878c8', execution: '#129887', task: '#5686a6'};
    const date = value =>
    {
        if(!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
        const time = Date.parse(value + 'T00:00:00Z');
        return Number.isFinite(time) && time >= Date.UTC(1900, 0, 1) && time < Date.UTC(2100, 0, 1) && iso(time) === value ? time : null;
    };
    const iso = time => new Date(time).toISOString().slice(0, 10);
    const days = (a, b) => Math.round((b - a) / DAY);
    const today = () => { const now = new Date(); return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()); };
    const validRange = (begin, end) => date(begin) !== null && date(end) !== null && begin <= end && days(date(begin), date(end)) <= 3660;

    function visibleRows(nodes, state)
    {
        const map = new Map(nodes.map(node => [node.id, node]));
        const children = new Map();
        nodes.forEach(node =>
        {
            const parent = map.has(node.parent) && node.parent !== node.id ? node.parent : '';
            if(!children.has(parent)) children.set(parent, []);
            children.get(parent).push(node);
        });
        const descendants = new Set();
        function mark(id)
        {
            if(descendants.has(id)) return;
            descendants.add(id);
            (children.get(id) || []).forEach(node => mark(node.id));
        }
        if(state.scope) mark(state.scope);
        const keep = new Set();
        const search = (state.search || '').toLocaleLowerCase();
        nodes.forEach(node =>
        {
            if(state.scope && !descendants.has(node.id)) return;
            if(node.type === 'execution' && !state.executions) return;
            if(node.type === 'task' && !state.tasks) return;
            /* Status filtering applies to program subtrees, not task status. */
            let program = node;
            const seen = new Set();
            let matches = !state.status || state.status === 'all';
            while(program && !seen.has(program.id))
            {
                seen.add(program.id);
                if(program.type === 'program' && (state.status === 'unclosed' ? program.status !== 'closed' : program.status === state.status)) matches = true;
                program = map.get(program.parent);
            }
            if(!matches || (search && !node.name.toLocaleLowerCase().includes(search))) return;
            let current = node;
            const visited = new Set();
            while(current && !visited.has(current.id))
            {
                visited.add(current.id);
                keep.add(current.id);
                if(current.id === state.scope) break;
                current = map.get(current.parent);
            }
        });
        const result = [], visited = new Set();
        function visit(node, depth)
        {
            if(visited.has(node.id) || !keep.has(node.id)) return;
            visited.add(node.id);
            const hiddenType = (node.type === 'execution' && !state.executions) || (node.type === 'task' && !state.tasks);
            const nested = (children.get(node.id) || []).some(child => keep.has(child.id));
            if(!hiddenType) result.push({...node, depth, nested});
            if(!hiddenType && state.collapsed.has(node.id) && !search) return;
            (children.get(node.id) || []).forEach(child => visit(child, depth + (hiddenType ? 0 : 1)));
        }
        if(state.scope && map.has(state.scope)) visit(map.get(state.scope), 0);
        else (children.get('') || []).forEach(node => visit(node, 0));
        return result;
    }

    function ticks(start, finish, scale)
    {
        let cursor = new Date(start);
        if(scale === 'week') cursor.setUTCDate(cursor.getUTCDate() - (cursor.getUTCDay() + 6) % 7);
        if(scale === 'month' || scale === 'quarter') cursor.setUTCDate(1);
        if(scale === 'quarter') cursor.setUTCMonth(Math.floor(cursor.getUTCMonth() / 3) * 3);
        const output = [];
        while(cursor.getTime() <= finish)
        {
            const from = cursor.getTime(), year = cursor.getUTCFullYear(), month = cursor.getUTCMonth() + 1;
            const label = scale === 'quarter' ? year + ' Q' + Math.ceil(month / 3) : scale === 'month' ? year + '-' + String(month).padStart(2, '0') : iso(from);
            if(scale === 'quarter') cursor.setUTCMonth(cursor.getUTCMonth() + 3);
            else if(scale === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
            else cursor.setUTCDate(cursor.getUTCDate() + (scale === 'week' ? 7 : 1));
            output.push({start: Math.max(start, from), end: Math.min(finish + DAY, cursor.getTime()), label});
        }
        return output;
    }

    /* Keep full dates in tooltips; compact labels fit the visible calendar cells. */
    function calendarBands(start, finish, scale, locale = 'en')
    {
        const daily = scale === 'day', monthlyGroups = daily || scale === 'week';
        const format = (time, options) => new Intl.DateTimeFormat(locale, {...options, timeZone: 'UTC'}).format(time);
        const major = monthlyGroups ? ticks(start, finish, 'month') : [];
        if(!monthlyGroups)
        {
            for(let year = new Date(start).getUTCFullYear(); year <= new Date(finish).getUTCFullYear(); year++)
                major.push({start: Math.max(start, Date.UTC(year, 0, 1)), end: Math.min(finish + DAY, Date.UTC(year + 1, 0, 1)), label: String(year)});
        }
        else major.forEach(tick => { tick.label = format(tick.start, {year: 'numeric', month: 'long'}); });
        const minor = ticks(start, finish, daily ? 'day' : scale).map(tick => ({...tick,
            label: daily ? String(new Date(tick.start).getUTCDate()) : scale === 'week' ? format(tick.start, {month: 'numeric', day: 'numeric'}) + '–' + format(tick.end - DAY, {month: 'numeric', day: 'numeric'}) : scale === 'quarter' ? 'Q' + Math.ceil((new Date(tick.start).getUTCMonth() + 1) / 3) : format(tick.start, {month: 'short'}),
            weekday: daily ? format(tick.start, {weekday: 'short'}) : '',
            weekend: daily && [0, 6].includes(new Date(tick.start).getUTCDay())}));
        return {major, minor};
    }

    /** A small PDF 1.4 writer: each page embeds a local JPEG, preserving CJK glyphs. */
    function makePDF(pages)
    {
        const encoder = new TextEncoder(), chunks = [], offsets = [0];
        let length = 0;
        const append = data => { const bytes = typeof data === 'string' ? encoder.encode(data) : data; chunks.push(bytes); length += bytes.length; };
        const object = (id, body) => { offsets[id] = length; append(id + ' 0 obj\n'); body(); append('\nendobj\n'); };
        append('%PDF-1.4\n');
        object(1, () => append('<< /Type /Catalog /Pages 2 0 R >>'));
        object(2, () => append('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] >>'));
        pages.forEach((page, i) =>
        {
            const id = 3 + i * 3, pageWidth = 1190.55, pageHeight = 841.89;
            object(id, () => append('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageWidth + ' ' + pageHeight + '] /Resources << /XObject << /Image ' + (id + 1) + ' 0 R >> >> /Contents ' + (id + 2) + ' 0 R >>'));
            object(id + 1, () =>
            {
                append('<< /Type /XObject /Subtype /Image /Width ' + page.width + ' /Height ' + page.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.bytes.length + ' >>\nstream\n');
                append(page.bytes); append('\nendstream');
            });
            const ratio = Math.min((pageWidth - 40) / page.width, (pageHeight - 40) / page.height);
            const stream = 'q\n' + (page.width * ratio) + ' 0 0 ' + (page.height * ratio) + ' 20 ' + (pageHeight - 20 - page.height * ratio) + ' cm\n/Image Do\nQ\n';
            object(id + 2, () => append('<< /Length ' + encoder.encode(stream).length + ' >>\nstream\n' + stream + 'endstream'));
        });
        const xref = length;
        append('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n');
        offsets.slice(1).forEach(offset => append(String(offset).padStart(10, '0') + ' 00000 n \n'));
        append('trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
        return new Blob(chunks, {type: 'application/pdf'});
    }

    const api = {date, iso, days, validRange, visibleRows, ticks, calendarBands, makePDF};
    if(typeof module !== 'undefined' && module.exports) module.exports = api;
    if(!global.document) return;

    function mount(root, options)
    {
        const lang = options.lang;
        let nodes = options.nodes, disposed = false;
        const requests = new AbortController();
        const dates = nodes.flatMap(node => [date(node.begin), date(node.end)]).filter(value => value !== null);
        const first = dates.length ? dates.reduce((a, b) => Math.min(a, b)) : today() - 14 * DAY;
        const last = dates.length ? dates.reduce((a, b) => Math.max(a, b)) : today() + 60 * DAY;
        const state = {scope: options.programID ? 'p' + options.programID : '', status: 'all', scale: 'week', search: '',
            executions: true, tasks: true, dates: true, owner: true, statusField: true, progress: true, editing: false,
            begin: iso(Math.max(Date.UTC(1900, 0, 1), first - 7 * DAY)), end: iso(Math.min(Date.UTC(2099, 11, 31), last + 14 * DAY, first + 3650 * DAY)), collapsed: new Set(), busy: false};
        const el = (tag, className, text) => { const item = document.createElement(tag); if(className) item.className = className; if(text !== undefined) item.textContent = text; return item; };
        const button = (text, action) => { const item = el('button', 'btn size-sm', text); item.type = 'button'; item.addEventListener('click', action); return item; };
        const toolbar = el('div', 'pg-toolbar');
        const controls = el('div', 'pg-toolbar');
        const viewbar = el('div', 'pg-viewbar');
        const countLabel = el('span', 'pg-count');
        const viewButtons = el('div', 'pg-views'); viewButtons.setAttribute('role', 'group'); viewButtons.setAttribute('aria-label', lang.view);
        viewbar.append(countLabel, viewButtons);
        const notice = el('p', 'pg-notice'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
        const viewport = el('div', 'pg-viewport'); viewport.tabIndex = 0;
        const grid = el('div', 'pg-grid'); viewport.append(grid);
        const dialog = el('dialog', 'pg-dialog');
        root.replaceChildren(toolbar, controls, notice, viewbar, viewport, dialog);
        const message = (text, error = false) => { notice.textContent = text; notice.classList.toggle('pg-error', error); };
        const labeled = (container, text, input) => { const label = el('label', 'pg-control'); label.append(el('span', '', text), input); container.append(label); };
        const select = (container, label, values, initial, onChange) =>
        {
            const input = el('select', 'form-control');
            values.forEach(([value, text]) => { const option = el('option', '', text); option.value = value; input.append(option); });
            input.value = initial; input.addEventListener('change', () => onChange(input.value)); labeled(container, label, input); return input;
        };
        const scopeSelect = select(toolbar, lang.program, [['', lang.all], ...nodes.filter(node => node.type === 'program').map(node => [node.id, node.name])], state.scope, value => { state.scope = value; render(); });
        select(toolbar, lang.status, ['all','unclosed','wait','doing','suspended','closed'].map(value => [value, lang[value === 'all' ? 'allStatus' : value]]), state.status, value => { state.status = value; render(); });
        ['day','week','month','quarter'].forEach(value =>
        {
            const item = button(lang[value], () => { state.scale = value; render(); });
            item.dataset.scale = value; viewButtons.append(item);
        });
        viewbar.append(button(lang.today, focusToday));
        const search = el('input', 'form-control'); search.type = 'search'; search.placeholder = lang.search;
        let searchTimer;
        search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = search.value; render(); }, 150); });
        labeled(toolbar, lang.search, search);
        const dateControls = [];
        ['begin', 'end'].forEach(key =>
        {
            const input = el('input', 'form-control'); input.type = 'date'; input.value = state[key]; input.min = '1900-01-01'; input.max = '2099-12-31';
            input.addEventListener('change', () =>
            {
                const proposed = {...state, [key]: input.value};
                if(!validRange(proposed.begin, proposed.end)) { message(lang.rangeError, true); input.value = state[key]; return; }
                state[key] = input.value; render();
            });
            labeled(toolbar, lang[key], input); dateControls.push(input);
        });
        const checkbox = (text, key, container = controls) =>
        {
            const input = el('input'); input.type = 'checkbox'; input.checked = state[key];
            input.addEventListener('change', () => { state[key] = input.checked; render(); });
            const label = el('label', 'pg-check'); label.append(input, document.createTextNode(text)); container.append(label); return input;
        };
        checkbox(lang.execution, 'executions'); checkbox(lang.task, 'tasks'); checkbox(lang.dates, 'dates');
        const fields = el('details', 'pg-fields'); fields.append(el('summary', 'btn size-sm', lang.fields));
        const fieldPanel = el('div', 'pg-field-panel'); fields.append(fieldPanel); controls.append(fields);
        checkbox(lang.owner, 'owner', fieldPanel); checkbox(lang.status, 'statusField', fieldPanel); checkbox(lang.progress, 'progress', fieldPanel);
        controls.append(button(lang.expand, () => { state.collapsed.clear(); render(); }), button(lang.collapse, () => { nodes.forEach(node => state.collapsed.add(node.id)); render(); }));
        viewbar.append(button(lang.fullscreen, async () =>
        {
            try { if(document.fullscreenElement) await document.exitFullscreen(); else await root.requestFullscreen(); }
            catch(error) { message(error.message, true); }
        }));
        controls.append(button(lang.refresh, refreshChart));
        const capabilities = el('span', 'pg-capabilities'); controls.append(capabilities);
        function updateCapabilities()
        {
            capabilities.replaceChildren();
            if(options.canEdit) checkbox(lang.editing, 'editing', capabilities);
            else state.editing = false;
            if(options.canExport) capabilities.append(button(lang.png, () => exportChart('png')), button(lang.pdf, () => exportChart('pdf')));
        }
        updateCapabilities();

        async function refreshChart()
        {
            if(state.busy || disposed) return;
            state.busy = true;
            message(lang.refreshing);
            const inputs = [...root.querySelectorAll('.pg-toolbar input,.pg-toolbar select,.pg-toolbar button,.pg-viewbar button')];
            inputs.forEach(input => { input.disabled = true; });
            try
            {
                const result = await request(options.dataURL);
                if(disposed || !root.isConnected) return;
                Object.assign(options, result.options);
                nodes = result.options.nodes;
                if(state.scope && !nodes.some(node => node.id === state.scope)) state.scope = '';
                scopeSelect.replaceChildren();
                [['', lang.all], ...nodes.filter(node => node.type === 'program').map(node => [node.id, node.name])].forEach(([value, text]) =>
                {
                    const item = el('option', '', text); item.value = value; scopeSelect.append(item);
                });
                scopeSelect.value = state.scope;
                state.collapsed = new Set([...state.collapsed].filter(id => nodes.some(node => node.id === id)));
                updateCapabilities();
                render();
            }
            catch(error) { if(!disposed) message(lang.refreshFailed, true); }
            finally { state.busy = false; inputs.forEach(input => { input.disabled = false; }); }
        }

        const columns = () => [{key: 'name', text: lang.name, width: 340}, {key: 'duration', text: lang.duration, width: 80}];
        const duration = row => date(row.begin) !== null && date(row.end) !== null && row.end >= row.begin ? String(days(date(row.begin), date(row.end)) + 1) + ' ' + lang.days : '—';
        const textValue = (row, key) => key === 'duration' ? duration(row) : key === 'status' ? (lang[row.status] || row.status || '—') : key === 'progress' ? (row.progress === undefined || row.progress === null ? '—' : row.progress + '%') : row[key] || '—';
        const rowDetails = row => ({
            top: [
                ...(state.owner ? [{key: 'owner', text: lang.owner + ': ' + textValue(row, 'owner')}] : []),
                ...(state.statusField ? [{key: 'status', text: lang.status + ': ' + textValue(row, 'status')}] : [])],
            bottom: [
                ...(state.dates ? [{key: 'begin', text: textValue(row, 'begin'), label: lang.begin}, {key: 'end', text: '→ ' + textValue(row, 'end'), label: lang.end}] : []),
                ...(state.progress ? [{key: 'progress', text: lang.progress + ': ' + textValue(row, 'progress')}] : [])]
        });
        const calendarText = (tick, level, width) =>
        {
            if(level === 'major' && width < 65) return String(new Date(tick.start).getUTCMonth() + 1);
            if(level === 'minor' && state.scale === 'week' && width < 85)
            {
                const from = new Date(tick.start).getUTCDate(), to = new Date(tick.end - DAY).getUTCDate();
                return String(from) + (tick.end - tick.start > DAY ? '–' + to : '');
            }
            return tick.label + (tick.weekday ? ' ' + tick.weekday : '');
        };
        const scaleWidth = () => ({day: 72, week: 24, month: 120 / 30, quarter: 160 / 91})[state.scale];
        let rows = [], header, content, leftWidth, timelineWidth, px, rangeStart, rangeEnd;
        const geometry = row =>
        {
            const begin = date(row.begin), end = date(row.end);
            if(begin === null || end === null || end < begin || end < rangeStart || begin > rangeEnd) return null;
            return {left: days(rangeStart, Math.max(begin, rangeStart)) * px, width: Math.max(3, (days(Math.max(begin, rangeStart), Math.min(end, rangeEnd)) + 1) * px), begin, end};
        };
        function focusToday()
        {
            const now = today(), span = days(date(state.begin), date(state.end));
            if(now < date(state.begin) || now > date(state.end))
            {
                const start = Math.max(Date.UTC(1900, 0, 1), Math.min(now - Math.min(7, span) * DAY, Date.UTC(2099, 11, 31) - span * DAY));
                state.begin = iso(start); state.end = iso(start + span * DAY);
                dateControls[0].value = state.begin; dateControls[1].value = state.end;
                render();
            }
            viewport.scrollLeft = Math.max(0, days(rangeStart, now) * px - Math.max(0, viewport.clientWidth - leftWidth) / 2);
        }
        function render()
        {
            if(disposed || !root.isConnected) return;
            const scroll = {top: viewport.scrollTop, left: viewport.scrollLeft};
            rows = visibleRows(nodes, state);
            rangeStart = date(state.begin); rangeEnd = date(state.end); px = scaleWidth();
            timelineWidth = (days(rangeStart, rangeEnd) + 1) * px;
            const cols = columns(); leftWidth = cols.reduce((total, col) => total + col.width, 0);
            grid.style.width = (leftWidth + timelineWidth) + 'px';
            header = el('div', 'pg-header'); header.style.width = grid.style.width;
            const fixed = el('div', 'pg-fixed pg-heading'); fixed.style.width = leftWidth + 'px';
            cols.forEach(col => { const cell = el('div', 'pg-cell', col.text); cell.style.width = col.width + 'px'; fixed.append(cell); }); header.append(fixed);
            const scale = el('div', 'pg-scale'); scale.style.width = timelineWidth + 'px';
            const bands = calendarBands(rangeStart, rangeEnd, state.scale, lang.locale);
            ['major', 'minor'].forEach(level => bands[level].forEach(tick =>
            {
                const width = days(tick.start, tick.end) * px;
                const text = level === 'minor' && tick.weekday ? tick.label : calendarText(tick, level, width);
                const label = el('div', 'pg-tick pg-' + level, text);
                label.style.left = (days(rangeStart, tick.start) * px) + 'px'; label.style.width = (days(tick.start, tick.end) * px) + 'px';
                label.title = iso(tick.start) + ' → ' + iso(tick.end - DAY);
                if(tick.weekday) label.append(el('span', 'pg-weekday', tick.weekday));
                if(tick.weekend) label.classList.add('pg-weekend');
                if(level === 'minor' && today() >= tick.start && today() < tick.end) label.classList.add('pg-current');
                scale.append(label);
            })); header.append(scale);
            viewButtons.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.scale === state.scale)));
            countLabel.textContent = rows.length + ' ' + lang.count;

            content = el('div', 'pg-content'); content.style.height = Math.max(HEIGHT, rows.length * HEIGHT) + 'px';
            grid.replaceChildren(header, content);
            viewport.scrollTop = scroll.top; viewport.scrollLeft = scroll.left;
            message((state.editing ? lang.editHint : lang.readonlyHint) + ' · ' + rows.length + ' ' + lang.count);
            renderWindow();
        }
        function renderWindow()
        {
            if(!content) return;
            const fragment = document.createDocumentFragment();
            const start = Math.max(0, Math.floor((viewport.scrollTop - HEADER_HEIGHT) / HEIGHT) - 8);
            const end = Math.min(rows.length, start + Math.ceil(viewport.clientHeight / HEIGHT) + 18);
            if(!rows.length) fragment.append(el('div', 'pg-empty', lang.empty));
            for(let i = start; i < end; i++)
            {
                const row = rows[i], line = el('div', 'pg-row'); line.style.top = (i * HEIGHT) + 'px'; line.dataset.id = row.id; line.classList.toggle('pg-alternate', i % 2 === 1);
                const fixed = el('div', 'pg-fixed'); fixed.style.width = leftWidth + 'px';
                columns().forEach(col =>
                {
                    const cell = el('div', 'pg-cell'); cell.style.width = col.width + 'px';
                    if(col.key === 'name')
                    {
                        cell.style.paddingLeft = (8 + Math.min(row.depth, 15) * 16) + 'px';
                        if(row.nested)
                        {
                            const toggle = button(state.collapsed.has(row.id) ? '▸' : '▾', () => { if(state.collapsed.has(row.id)) state.collapsed.delete(row.id); else state.collapsed.add(row.id); render(); });
                            toggle.className = 'pg-toggle'; toggle.setAttribute('aria-expanded', String(!state.collapsed.has(row.id))); toggle.setAttribute('aria-label', row.name); cell.append(toggle);
                        }
                        const info = el('div', 'pg-task-info');
                        const meta = el('div', 'pg-task-meta');
                        const type = el('span', 'pg-type', lang[row.type]); type.style.color = COLORS[row.type];
                        meta.append(type, el('span', '', '#' + row.objectID));
                        const details = rowDetails(row);
                        const detailLine = (container, values) => values.forEach(detail =>
                        {
                            const item = el('span', 'pg-detail pg-detail-' + detail.key, detail.text);
                            item.title = detail.label ? detail.label + ': ' + textValue(row, detail.key) : detail.text;
                            container.append(item);
                        });
                        detailLine(meta, details.top);
                        info.append(meta, el('span', 'pg-name', row.name));
                        if(details.bottom.length)
                        {
                            const schedule = el('div', 'pg-task-schedule'); detailLine(schedule, details.bottom); info.append(schedule);
                        }
                        cell.append(info);
                        if(options.canEdit && state.editing && row.editable)
                        {
                            const edit = button('✎', () => editDates(row)); edit.className = 'pg-date-edit'; edit.title = lang.editDates; edit.setAttribute('aria-label', lang.editDates + ': ' + row.name); cell.append(edit);
                        }
                    }
                    else cell.textContent = textValue(row, col.key);
                    cell.title = textValue(row, col.key); fixed.append(cell);
                }); line.append(fixed);
                const track = el('div', 'pg-track'); track.style.width = timelineWidth + 'px';
                track.style.backgroundSize = (state.scale === 'day' ? px : state.scale === 'week' ? 7 * px : 0) + 'px 100%';
                if(state.scale === 'week') track.style.backgroundPositionX = (-((new Date(rangeStart).getUTCDay() + 6) % 7) * px) + 'px';
                if(state.scale === 'day')
                {
                    const weekend = el('div', 'pg-weekend-shade');
                    weekend.style.backgroundSize = (7 * px) + 'px 100%';
                    weekend.style.backgroundImage = 'linear-gradient(to right, #f1f5f980 ' + (2 * px) + 'px, transparent ' + (2 * px) + 'px)';
                    weekend.style.backgroundPositionX = (-((new Date(rangeStart).getUTCDay() + 1) % 7) * px) + 'px';
                    track.append(weekend);
                }
                const bar = geometry(row);
                if(bar)
                {
                    const item = el('div', 'pg-bar'); item.style.left = bar.left + 'px'; item.style.width = bar.width + 'px'; item.style.backgroundColor = COLORS[row.type];
                    item.title = row.name + ' · ' + row.begin + ' → ' + row.end + ' · ' + row.progress + '%';
                    const fill = el('span', 'pg-bar-progress'); fill.style.width = row.progress + '%'; item.append(fill, el('span', 'pg-bar-label', row.name));
                    if(options.canEdit && state.editing && row.editable)
                    {
                        item.classList.add('pg-draggable'); item.tabIndex = 0; item.setAttribute('role', 'button'); item.setAttribute('aria-label', lang.editDates + ': ' + item.title);
                        ['begin', 'end'].forEach(side => { const grip = el('span', 'pg-grip pg-' + side); grip.dataset.edge = side; item.append(grip); });
                        item.addEventListener('pointerdown', event => startDrag(event, row, item, bar));
                        item.addEventListener('dblclick', () => editDates(row));
                        item.addEventListener('keydown', event => { if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editDates(row); } });
                    }
                    track.append(item);
                }
                else if(!row.begin || !row.end) track.append(el('span', 'pg-unscheduled', lang.unscheduled));
                const now = days(rangeStart, today()) * px;
                if(now >= 0 && now <= timelineWidth) { const marker = el('span', 'pg-today'); marker.style.left = now + 'px'; marker.style.width = px + 'px'; marker.title = lang.today; track.append(marker); }
                line.append(track); fragment.append(line);
            }
            content.replaceChildren(fragment);
        }
        let scrolling = false, dragging = false;
        viewport.addEventListener('scroll', () =>
        {
            if(scrolling || dragging) return;
            scrolling = true; requestAnimationFrame(() => { scrolling = false; renderWindow(); });
        });
        const observer = new ResizeObserver(() => { if(!dragging) renderWindow(); }); observer.observe(viewport);
        function startDrag(event, row, item, bar)
        {
            if(state.busy || event.button !== 0 || event.detail > 1) return;
            event.preventDefault(); item.setPointerCapture(event.pointerId); dragging = true;
            const x = event.clientX, edge = event.target.dataset.edge;
            let shift = 0;
            const move = event =>
            {
                shift = Math.round((event.clientX - x) / px);
                if(edge === 'begin') shift = Math.min(shift, days(bar.begin, bar.end));
                if(edge === 'end') shift = Math.max(shift, -days(bar.begin, bar.end));
                const begin = bar.begin + (edge === 'end' ? 0 : shift * DAY), end = bar.end + (edge === 'begin' ? 0 : shift * DAY);
                item.style.left = (days(rangeStart, Math.max(begin, rangeStart)) * px) + 'px';
                item.style.width = Math.max(3, (days(Math.max(begin, rangeStart), Math.min(end, rangeEnd)) + 1) * px) + 'px';
                item.title = iso(begin) + ' → ' + iso(end);
            };
            const cleanup = () => { dragging = false; item.removeEventListener('pointermove', move); item.removeEventListener('pointerup', up); item.removeEventListener('pointercancel', cancel); };
            const cancel = () => { cleanup(); render(); };
            const up = () =>
            {
                cleanup(); render();
                if(shift) editDates(row, iso(bar.begin + (edge === 'end' ? 0 : shift * DAY)), iso(bar.end + (edge === 'begin' ? 0 : shift * DAY)));
            };
            item.addEventListener('pointermove', move); item.addEventListener('pointerup', up); item.addEventListener('pointercancel', cancel);
        }
        async function request(url, body)
        {
            const response = await fetch(url, {method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: requests.signal,
                headers: {'X-Requested-With': 'XMLHttpRequest'}, ...(body ? {body: new URLSearchParams(body)} : {})});
            if(!response.ok) throw new Error(lang.networkError);
            const result = await response.json();
            if(result.result !== 'success') throw new Error(typeof result.message === 'string' ? result.message : lang.saveFailed);
            return result;
        }
        function editDates(row, begin = row.begin, end = row.end)
        {
            if(state.busy || dialog.open) return;
            const form = el('form'); form.method = 'dialog';
            const title = el('h3', '', lang.editDates); const name = el('p', '', row.name); const hint = el('p', '', lang.confirm);
            const inputs = {};
            form.append(title, name, hint);
            ['begin','end'].forEach(key =>
            {
                const input = el('input', 'form-control'); input.type = 'date'; input.required = true; input.min = '1900-01-01'; input.max = '2099-12-31'; input.value = key === 'begin' ? begin : end;
                inputs[key] = input; labeled(form, lang[key], input);
            });
            const error = el('p', 'pg-error'); error.setAttribute('role', 'alert'); form.append(error);
            const actions = el('div', 'pg-toolbar');
            const save = el('button', 'btn primary', lang.save); save.type = 'submit';
            const cancel = button(lang.cancelButton, () => { if(!state.busy) dialog.close(); }); actions.append(save, cancel); form.append(actions);
            form.addEventListener('submit', async event =>
            {
                event.preventDefault();
                if(date(inputs.begin.value) === null || date(inputs.end.value) === null || inputs.begin.value > inputs.end.value) { error.textContent = lang.invalidDates; return; }
                state.busy = true; save.disabled = cancel.disabled = true; save.textContent = lang.saving;
                try
                {
                    await request(options.saveURL, {token: options.token, id: row.objectID, type: row.type, begin: inputs.begin.value, end: inputs.end.value, oldBegin: row.begin, oldEnd: row.end});
                    const original = nodes.find(node => node.id === row.id); original.begin = inputs.begin.value; original.end = inputs.end.value;
                    dialog.close(); render(); message(lang.saved);
                }
                catch(failure) { error.textContent = failure.message || lang.networkError; }
                finally { state.busy = false; save.disabled = cancel.disabled = false; save.textContent = lang.save; }
            });
            dialog.replaceChildren(form); dialog.showModal();
        }
        dialog.addEventListener('cancel', event => { if(state.busy) event.preventDefault(); });

        function drawPage(pageRows, start, finish, pageNumber, pageCount)
        {
            const cols = columns(), left = cols.reduce((total, col) => total + col.width, 0);
            const width = left + (days(start, finish) + 1) * px;
            const canvas = document.createElement('canvas'); canvas.width = Math.ceil(width); canvas.height = 60 + HEADER_HEIGHT + Math.max(1, pageRows.length) * HEIGHT;
            const ctx = canvas.getContext('2d');
            if(!ctx) throw new Error(lang.exportFailed);
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#17233d'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(lang.title, 14, 25);
            ctx.font = '12px sans-serif'; ctx.fillText(iso(start) + ' → ' + iso(finish) + '   ' + pageNumber + '/' + pageCount, 14, 48);
            ctx.fillStyle = '#edf2f8'; ctx.fillRect(0, 60, width, HEADER_HEIGHT);
            let offset = 0;
            const cellText = (text, x, y, cellWidth, color = '#253858') =>
            {
                ctx.save(); ctx.beginPath(); ctx.rect(x + 4, y - 16, Math.max(0, cellWidth - 8), 30); ctx.clip(); ctx.fillStyle = color; let fitted = String(text);
                if(ctx.measureText(fitted).width > cellWidth - 16)
                {
                    while(fitted && ctx.measureText(fitted + '…').width > cellWidth - 16) fitted = fitted.slice(0, -1);
                    fitted = fitted ? fitted + '…' : '';
                }
                ctx.fillText(fitted, x + 8, y); ctx.restore();
            };
            cols.forEach(col => { cellText(col.text, offset, 99, col.width); offset += col.width; });
            const bands = calendarBands(start, finish, state.scale, lang.locale);
            ['major', 'minor'].forEach((level, index) => bands[level].forEach(tick =>
            {
                const x = left + days(start, tick.start) * px;
                cellText(calendarText(tick, level, days(tick.start, tick.end) * px), x, 83 + index * 32, days(tick.start, tick.end) * px);
                ctx.strokeStyle = '#e4e9f0'; ctx.beginPath(); ctx.moveTo(x, 60 + index * 32); ctx.lineTo(x, 60 + HEADER_HEIGHT); ctx.stroke();
            }));
            pageRows.forEach((row, i) =>
            {
                const y = 60 + HEADER_HEIGHT + i * HEIGHT;
                if(i % 2 === 1) { ctx.fillStyle = '#f5f7fa'; ctx.fillRect(0, y, width, HEIGHT); }
                bands.minor.forEach(tick =>
                {
                    const tickX = left + days(start, tick.start) * px, tickWidth = days(tick.start, tick.end) * px;
                    if(tick.weekend) { ctx.fillStyle = '#f1f5f980'; ctx.fillRect(tickX, y, tickWidth, HEIGHT); }
                    ctx.strokeStyle = '#e4e9f0'; ctx.beginPath(); ctx.moveTo(tickX, y); ctx.lineTo(tickX, y + HEIGHT); ctx.stroke();
                });
                if(today() >= start && today() <= finish)
                {
                    ctx.fillStyle = '#2878c812'; ctx.fillRect(left + days(start, today()) * px, y, px, HEIGHT);
                }
                let x = 0;
                cols.forEach(col =>
                {
                    const indent = col.key === 'name' ? Math.min(row.depth, 15) * 12 : 0;
                    if(col.key === 'name')
                    {
                        const details = rowDetails(row);
                        ctx.font = '10px sans-serif';
                        cellText([lang[row.type] + ' #' + row.objectID, ...details.top.map(item => item.text)].join('  '), x + indent, y + 15, col.width - indent, '#8492a6');
                        ctx.font = '12px sans-serif';
                        cellText(row.name, x + indent, y + 32, col.width - indent);
                        ctx.font = '10px sans-serif';
                        cellText(details.bottom.map(item => item.text).join('  '), x + indent, y + 47, col.width - indent, '#8492a6');
                        ctx.font = '12px sans-serif';
                    }
                    else cellText(textValue(row, col.key), x, y + 33, col.width);
                    x += col.width;
                });
                const begin = date(row.begin), end = date(row.end);
                if(begin !== null && end !== null && end >= begin && end >= start && begin <= finish)
                {
                    const barX = left + days(start, Math.max(start, begin)) * px;
                    const barWidth = Math.max(2, (days(Math.max(start, begin), Math.min(finish, end)) + 1) * px);
                    ctx.fillStyle = COLORS[row.type]; ctx.fillRect(barX, y + 11, barWidth, 34);
                    ctx.fillStyle = '#0003'; ctx.fillRect(barX, y + 11, barWidth * row.progress / 100, 34);
                    ctx.save(); ctx.beginPath(); ctx.rect(barX, y + 11, barWidth, 34); ctx.clip();
                    ctx.fillStyle = '#fff'; ctx.fillText(row.name, barX + 8, y + 33); ctx.restore();
                }
                else if(begin === null || end === null) cellText(lang.unscheduled, left, y + 23, width - left);
                ctx.strokeStyle = '#e4e9f0'; ctx.beginPath(); ctx.moveTo(0, y + HEIGHT); ctx.lineTo(width, y + HEIGHT); ctx.stroke();
            });
            return canvas;
        }
        function download(blob, extension)
        {
            const url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = 'program-gantt-' + state.begin + '.' + extension; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
        }
        async function exportChart(format)
        {
            if(state.busy) return;
            state.busy = true; message(lang.exporting);
            const inputs = [...toolbar.querySelectorAll('input,select,button'), ...controls.querySelectorAll('input,select,button'), ...viewbar.querySelectorAll('button')];
            inputs.forEach(input => { input.disabled = true; });
            try
            {
                /* Fresh server data and permission checks prevent stale exports after access changes. */
                const response = await request(options.exportURL);
                const exportRows = visibleRows(response.nodes, state);
                if(format === 'png')
                {
                    const width = columns().reduce((total, col) => total + col.width, 0) + timelineWidth;
                    const height = 60 + HEADER_HEIGHT + Math.max(1, exportRows.length) * HEIGHT;
                    if(width > 16384 || height > 16384 || width * height > 40000000) throw new Error(lang.exportLarge);
                    const canvas = drawPage(exportRows, rangeStart, rangeEnd, 1, 1);
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                    if(!blob) throw new Error(lang.exportFailed);
                    download(blob, 'png');
                }
                else
                {
                    const dayCount = Math.max(1, Math.floor(1100 / px)), rowCount = 24;
                    const horizontal = Math.ceil((days(rangeStart, rangeEnd) + 1) / dayCount), vertical = Math.max(1, Math.ceil(exportRows.length / rowCount));
                    if(horizontal * vertical > 500) throw new Error(lang.exportLarge);
                    const pages = [];
                    for(let h = 0; h < horizontal; h++) for(let v = 0; v < vertical; v++)
                    {
                        const start = rangeStart + h * dayCount * DAY, finish = Math.min(rangeEnd, start + (dayCount - 1) * DAY);
                        const canvas = drawPage(exportRows.slice(v * rowCount, (v + 1) * rowCount), start, finish, pages.length + 1, horizontal * vertical);
                        const encoded = atob(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
                        pages.push({width: canvas.width, height: canvas.height, bytes: Uint8Array.from(encoded, char => char.charCodeAt(0))});
                        canvas.width = canvas.height = 0;
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                    download(makePDF(pages), 'pdf');
                }
                message(lang.title + ' · ' + exportRows.length + ' ' + lang.count);
            }
            catch(error) { message(error.message || lang.exportFailed, true); }
            finally { state.busy = false; inputs.forEach(input => { input.disabled = false; }); }
        }
        render();
        return {destroy()
        {
            disposed = true;
            requests.abort();
            observer.disconnect();
            clearTimeout(searchTimer);
            if(dialog.open) dialog.close();
        }};
    }
    /* Zin partial navigation executes pageJS BEFORE replacing #main. */
    const options = typeof programGanttOptions !== 'undefined' ? programGanttOptions : global.programGanttOptions;
    if(options)
    {
        let instance, mountedRoot, active = true;
        const initialize = () =>
        {
            if(!active) return;
            const root = document.getElementById('programGantt');
            if(!root || !root.isConnected || (root === mountedRoot && root.querySelector('.pg-toolbar'))) return;
            if(instance) instance.destroy();
            instance = mount(root, options);
            mountedRoot = root;
        };
        const previousRender = global.afterPageRender, previousUnmount = global.onPageUnmount;
        global.afterPageRender = function(...args)
        {
            if(typeof previousRender === 'function') previousRender(...args);
            initialize();
        };
        global.onPageUnmount = function(...args)
        {
            active = false;
            if(instance) instance.destroy();
            if(typeof previousUnmount === 'function') previousUnmount(...args);
        };
        /* Also support first full-page rendering, without mounting an old root. */
        queueMicrotask(initialize);
    }
})(typeof window !== 'undefined' ? window : globalThis);
