(function (root) {
  'use strict';
  const operationalCommands = ['stage', 'pod', 'tracking', 'claim_create', 'upload_pod', 'offline_sync'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const namespace = user => `${user.org}:${user.id}`;
  const uuid = () => root.crypto.randomUUID();
  function contextFor(trip) {
    return {planVersion: trip.planVersion, assignmentId: trip.assignmentId, packageKeys: trip.packages.map(p => p.key)};
  }
  function selectTrips(data, user) {
    return (data.objects || []).filter(o => o.kind === 'shipment' && o.driverUserId === user.id && o.status !== 'CANCELLED');
  }
  function snapshotView(data, user) {
    const fields = ['id', 'kind', 'version', 'planVersion', 'assignmentId', 'driverUserId', 'status', 'stage', 'tracking', 'start', 'end', 'promisedAt', 'completedAt', 'delivered'];
    return {
      user: {id: user.id, org: user.org, username: user.username},
      savedAt: new Date().toISOString(),
      commands: (data.commands || []).filter(x => operationalCommands.includes(x)),
      trips: selectTrips(data, user).map(trip => {
        const result = {};
        for (const key of fields) if (trip[key] !== undefined) result[key] = clone(trip[key]);
        result.packages = (trip.packages || []).map(p => ({key: p.key, id: p.id, weightKg: p.weightKg}));
        result.stops = (trip.stops || []).map(stop => {
          const s = {arrival: stop.arrival, km: stop.km, windowStart: stop.windowStart, windowEnd: stop.windowEnd, orderReference: stop.orderReference};
          if (stop.destination) {
            s.destination = {};
            for (const key of ['name', 'postalCode', 'lat', 'lon', 'addressLine', 'number', 'complement', 'district', 'city', 'uf', 'deliveryInstructions']) {
              if (stop.destination[key] !== undefined) s.destination[key] = clone(stop.destination[key]);
            }
          }
          return s;
        });
        return result;
      })
    };
  }
  function makeRecord(user, trip, command, payload, photo, id = uuid()) {
    if (!['pod', 'tracking'].includes(command)) throw new Error('Somente comprovantes e atualizações podem ficar na fila offline.');
    return {id, owner: namespace(user), command, payload: clone(payload), context: contextFor(trip), photo: photo || null,
      uploadKey: `driver-photo-${id}`, sendKey: `driver-event-${id}`, status: 'PENDING', createdAt: new Date().toISOString()};
  }
  function sameUser(a, b) { return !!a && !!b && a.id === b.id && a.org === b.org; }
  async function synchronize({user, currentUser, store, fetchSession, send, sessionReady, progress = () => {}}) {
    const assertCurrent = () => { if (!sameUser(user, currentUser())) throw new Error('Entre novamente com o usuário que criou os registros.'); };
    assertCurrent();
    const session = await fetchSession();
    assertCurrent();
    if (!sameUser(user, session.user)) throw new Error('A sessão atual é de outro usuário. Os registros não foram enviados.');
    sessionReady(session);
    const rows = await store.list(namespace(user));
    let done = 0;
    for (const item of rows) {
      assertCurrent();
      if (item.owner !== namespace(user)) throw new Error('Registro local pertence a outro acesso.');
      if (item.status === 'BLOCKED') throw new Error('Há um registro que exige conferência da operação. Ele não será reenviado automaticamente.');
      try {
        if (item.photo && !item.payload.fileId) {
          item.uploadAttemptedAt = item.uploadAttemptedAt || new Date().toISOString();
          await store.put(item);
          assertCurrent();
          const file = await send('upload_pod', {shipmentId: item.payload.shipmentId, base64: item.photo}, item.uploadKey);
          item.payload.fileId = file.id;
          item.photo = null;
          await store.put(item);
        }
        assertCurrent();
        item.attemptedAt = item.attemptedAt || new Date().toISOString();
        await store.put(item);
        assertCurrent();
        await send('offline_sync', {command: item.command, payload: item.payload, context: item.context}, item.sendKey);
        await store.remove(item.owner, item.id);
        done += 1;
        progress(done);
      } catch (error) {
        item.lastError = error.code || error.message || 'Falha de comunicação';
        // A resposta perdida exige a mesma identidade e conteúdo; nunca gerar outro comprovante.
        if (error.status && ![401, 408, 429, 500, 502, 503, 504].includes(error.status)) item.status = 'BLOCKED';
        await store.put(item);
        throw error;
      }
    }
    return done;
  }
  async function sendPendingClaim({user, currentUser, record, fetchSession, sessionReady, send, confirmed}) {
    if (!sameUser(user, currentUser()) || record.owner !== namespace(user)) throw new Error('Entre com o usuário que criou esta ocorrência.');
    const fresh = await fetchSession();
    if (!sameUser(user, currentUser()) || !sameUser(user, fresh.user)) throw new Error('A sessão mudou. A ocorrência não foi reenviada.');
    sessionReady(fresh);
    const result = await send('claim_create', record.payload, record.key);
    await confirmed();
    return result;
  }
  const logic = {namespace, contextFor, selectTrips, snapshotView, makeRecord, sameUser, synchronize, sendPendingClaim};
  if (typeof module !== 'undefined' && module.exports) module.exports = logic;
  root.LinceDriver = logic;
  if (!root.document) return;

  const $ = s => document.querySelector(s);
  const element = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const statusText = {ASSIGNED: 'Preparando a coleta', IN_TRANSIT: 'Em transporte', PARTIAL: 'Entrega parcial', DELIVERED: 'Entregue', PICKUP: 'Coleta', HUB: 'Recebimento no centro', TRANSFER: 'Transferência', LAST_MILE: 'Última milha', DELIVERY: 'Em entrega'};
  const sequence = ['PICKUP', 'HUB', 'TRANSFER', 'LAST_MILE', 'DELIVERY'];
  const errors = {INVALID_LOGIN: 'Usuário ou senha incorretos.', SESSION_INVALID: 'A sessão expirou. Entre novamente.', LOGIN_REQUIRED: 'Entre novamente para sincronizar.', USER_REVOKED: 'Acesso indisponível. Fale com a operação.', OFFLINE_CONTEXT_CHANGED: 'A viagem mudou. O registro foi preservado e precisa de conferência da operação.', OFFLINE_EVENT_CONFLICT: 'A identificação já existe com dados diferentes. O registro precisa de conferência.', NOT_AT_DELIVERY: 'A viagem ainda não está na etapa de entrega.', DISPATCH_BLOCKED: 'A coleta depende da etiqueta e da avaliação documental pela operação.', VERSION_CONFLICT: 'A viagem mudou. Atualize antes de registrar a passagem.', NOT_FOUND: 'Viagem indisponível para este acesso.', ROLE_FORBIDDEN: 'Esta ação não está disponível para seu acesso.', INVALID_PACKAGES: 'Confira os volumes selecionados.', ALREADY_DELIVERED: 'Um volume já foi entregue. Confira o registro com a operação.', FILE_SIZE: 'Use uma foto de até 2 MB após a redução.', UNSAFE_OR_CORRUPT_IMAGE: 'A foto não pôde ser validada. Escolha outra imagem.'};
  let actor = null, session = null, view = null, selected = null, filter = 'active', syncing = false, online = navigator.onLine, installPrompt = null, pendingRows = [];
  let authGeneration = 0;
  const dateText = iso => iso ? new Date(iso).toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'}) : 'Não informado';
  const tripName = trip => `Viagem ${trip.id.slice(-6).toUpperCase()}`;
  const pendingKey = item => `queue:${item.owner}:${item.id}`;
  const dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('lince-driver-v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('records', {keyPath: 'key'});
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('O armazenamento local não está disponível. Não será confirmado um registro sem salvá-lo.'));
  });
  async function localOp(mode, work) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', mode), objectStore = tx.objectStore('records');
      let result;
      const req = work(objectStore);
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(new Error('Não foi possível salvar neste aparelho. Libere espaço e tente novamente; o registro não foi confirmado.'));
    });
  }
  const storage = {
    put: item => localOp('readwrite', s => s.put({key: pendingKey(item), value: clone(item)})),
    remove: (owner, id) => localOp('readwrite', s => s.delete(`queue:${owner}:${id}`)),
    list: async owner => (await localOp('readonly', s => s.getAll())).filter(x => x.key.startsWith(`queue:${owner}:`)).map(x => x.value).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    saveView: saved => localOp('readwrite', s => s.put({key: `view:${namespace(saved.user)}`, value: saved})),
    view: async user => (await localOp('readonly', s => s.get(`view:${namespace(user)}`)))?.value || null
  };
  storage.claim = async user => (await localOp('readonly', s => s.get(`claim:${namespace(user)}`)))?.value || null;
  storage.saveClaim = record => localOp('readwrite', s => s.put({key: `claim:${record.owner}`, value: record}));
  storage.removeClaim = user => localOp('readwrite', s => s.delete(`claim:${namespace(user)}`));
  function notice(text, isError = false) { const box = $('#notice'); box.hidden = false; box.className = 'notice' + (isError ? ' error' : ''); box.textContent = text; }
  function showConnection() { $('#connection').textContent = online ? 'Conectado' : 'Sem conexão · registros locais'; }
  async function api(path, {method = 'GET', body, key} = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') { headers['X-CSRF-Token'] = session?.csrf || ''; if (key) headers['Idempotency-Key'] = key; }
    let response;
    try { response = await fetch(path, {method, headers, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body)}); }
    catch (error) { online = false; showConnection(); throw error; }
    online = true; showConnection();
    if (!response.ok) {
      const data = await response.json().catch(() => ({})); const code = data.error?.code;
      const error = new Error(errors[code] || 'Não foi possível concluir. Confira os dados e a situação da viagem.');
      error.code = code; error.status = response.status; throw error;
    }
    return response.json();
  }
  const send = (command, payload, key) => api('/api/command', {method: 'POST', body: {command, payload}, key});
  function authenticatedWorkspace() { $('#login-panel').hidden = true; $('#workspace').hidden = false; $('#actor').textContent = actor.username; }
  async function refresh() {
    if (!actor) return;
    const expected = clone(actor), generation = authGeneration;
    const data = await api('/api/state');
    if (!sameUser(actor, expected) || authGeneration !== generation) return;
    if (!sameUser(data.user, expected)) throw new Error('A sessão mudou. Saia e entre novamente com seu acesso.');
    view = snapshotView(data, actor); await storage.saveView(view);
    renderTrips(); if (selected) renderDetails(selected); await renderQueue();
  }
  function renderTrips() {
    const list = $('#trips'); list.replaceChildren();
    $('#cached-at').textContent = `Última consulta: ${dateText(view?.savedAt)}. ${online ? '' : 'Dados salvos; a autorização será verificada ao sincronizar.'}`;
    const trips = (view?.trips || []).filter(t => filter === 'all' || (filter === 'done' ? t.status === 'DELIVERED' : t.status !== 'DELIVERED')).sort((a, b) => String(a.start).localeCompare(String(b.start)));
    if (!trips.length) { const empty = element('div', undefined, 'panel empty'); empty.append(element('strong', 'Nenhuma viagem nesta lista'), element('span', 'A operação precisa atribuir a viagem ao seu usuário de motorista. Atualize depois da atribuição.')); list.append(empty); }
    for (const trip of trips) {
      const card = element('article', undefined, 'trip'); card.append(element('h2', tripName(trip)), element('span', statusText[trip.status] || 'Situação a conferir', 'tag'));
      card.append(element('p', `${trip.packages.length} volumes · ${trip.delivered?.length || 0} entregues`), element('p', `Início: ${dateText(trip.start)}`), element('p', `Previsão: ${dateText(trip.promisedAt || trip.end)}`));
      const button = element('button', 'Abrir viagem'); button.onclick = () => { selected = trip.id; renderDetails(trip.id); $('#details').scrollIntoView({behavior: 'smooth'}); $('#trip-title').tabIndex = -1; $('#trip-title').focus(); }; card.append(button); list.append(card);
    }
  }
  function renderDetails(id) {
    document.body.classList.add("driver-trip-open");
    const trip = view?.trips.find(t => t.id === id); if (!trip) { selected = null; document.body.classList.remove('driver-trip-open'); $('#details').hidden = true; return; }
    $('#details').hidden = false; $('#trip-title').textContent = tripName(trip); $('#trip-summary').replaceChildren(element('span', statusText[trip.status] || trip.status, 'tag'), element('p', `${trip.delivered.length} de ${trip.packages.length} volumes entregues · etapa: ${statusText[trip.stage] || 'a conferir'}`));
    const stops = $('#stops'); stops.replaceChildren();
    for (const [index, stop] of trip.stops.entries()) {
      const li = element('li'), destination = stop.destination || {};
      li.append(element('strong', destination.name || `Parada ${index + 1}`));
      const address = [destination.addressLine, destination.number, destination.complement, destination.district, destination.city, destination.uf, destination.postalCode].filter(Boolean).join(', ');
      li.append(element('div', address || 'Endereço não informado'), element('div', `Chegada planejada: ${dateText(stop.arrival)}`));
      if (stop.windowStart || stop.windowEnd) li.append(element('div', `Janela: ${dateText(stop.windowStart)} até ${dateText(stop.windowEnd)}`));
      if (destination.deliveryInstructions) li.append(element('div', destination.deliveryInstructions));
      if (Number.isFinite(destination.lat) && Number.isFinite(destination.lon)) {
        const map = element('a', 'Abrir coordenadas no mapa externo'); map.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${destination.lat},${destination.lon}`)}`; map.target = '_blank'; map.rel = 'noreferrer noopener'; li.append(map);
      }
      stops.append(li);
    }
    if (!trip.stops.length) stops.append(element('li', 'Paradas não informadas. Consulte a operação.'));
    const packages = $('#packages'); packages.replaceChildren();
    const localPending = new Set(pendingRows.filter(item => item.command === 'pod' && item.payload.shipmentId === trip.id && item.payload.outcome === 'DELIVERED').flatMap(item => item.payload.packageKeys));
    for (const pack of trip.packages) {
      const label = element('label'), input = element('input'); input.type = 'checkbox'; input.name = 'packageKeys'; input.value = pack.key; input.disabled = trip.delivered.includes(pack.key) || localPending.has(pack.key); input.checked = !input.disabled;
      label.append(input, document.createTextNode(`Volume ${pack.id} · ${pack.weightKg} kg${trip.delivered.includes(pack.key) ? ' · já entregue' : localPending.has(pack.key) ? ' · aguardando confirmação' : ''}`)); packages.append(label);
    }
    $('#claim-packages').replaceChildren();
    for (const pack of trip.packages) {
      const label = element('label'), input = element('input'); input.type = 'checkbox'; input.value = pack.key;
      label.append(input, document.createTextNode(`Volume ${pack.id}`)); $('#claim-packages').append(label);
    }
    const delivery = ['IN_TRANSIT', 'PARTIAL'].includes(trip.status) && trip.stage === 'DELIVERY';
    $('#delivery-area').hidden = !delivery || !view.commands.includes('pod'); $('#tracking-area').hidden = !view.commands.includes('tracking'); $('#claim-area').hidden = !view.commands.includes('claim_create');
    let next = trip.status === 'ASSIGNED' ? 'PICKUP' : ['IN_TRANSIT', 'PARTIAL'].includes(trip.status) ? sequence[sequence.indexOf(trip.stage) + 1] : null;
    $('#stage-area').hidden = !next || !view.commands.includes('stage'); $('#stage').textContent = next ? `Confirmar ${statusText[next]}` : 'Etapas concluídas'; $('#stage').disabled = !online; $('#stage').dataset.next = next || '';
  }
  async function renderQueue() {
    if (!actor) return;
    const user = clone(actor), owner = namespace(user), rows = await storage.list(owner), claim = await storage.claim(user); if (!actor || namespace(actor) !== owner) return;
    pendingRows = rows;
    $('#queue-count').textContent = rows.length + (claim ? 1 : 0); $('#sync').disabled = syncing || !rows.length;
    const box = $('#queue-list'); box.replaceChildren();
    if (!rows.length && !claim) box.append(element('p', 'Nenhum registro pendente neste acesso.', 'small'));
    for (const item of rows) {
      const card = element('div', undefined, 'queue-record');
      card.append(element('strong', item.command === 'pod' ? (item.payload.outcome === 'DELIVERED' ? 'Comprovante de entrega' : 'Tentativa sem sucesso') : 'Atualização da viagem'), element('span', dateText(item.createdAt)), element('p', item.status === 'BLOCKED' ? 'Requer conferência da operação. Não será reenviado automaticamente.' : item.attemptedAt || item.uploadAttemptedAt ? 'Aguardando confirmação; a mesma identificação será preservada.' : 'Salvo neste aparelho; ainda não confirmado pelo sistema.'));
      if (item.lastError) card.append(element('p', errors[item.lastError] || 'A última tentativa não foi concluída.'));
      if (!item.attemptedAt && !item.uploadAttemptedAt) {
        const discard = element('button', 'Excluir rascunho não enviado', 'quiet'); discard.onclick = async () => { if (!confirm('Excluir este rascunho que ainda não foi enviado?')) return; if (!actor || namespace(actor) !== owner) return; await storage.remove(owner, item.id); await renderQueue(); }; card.append(discard);
      }
      box.append(card);
    }
    if (claim) {
      const card = element('div', undefined, 'queue-record'); card.append(element('strong', 'Ocorrência a confirmar'), element('p', claim.payload.description), element('p', 'A confirmação anterior não foi recebida. A mesma identificação será preservada.'));
      const retry = element('button', 'Confirmar ocorrência pendente'); retry.disabled = !online;
      retry.onclick = async () => { retry.disabled = true; try { await transmitClaim(user, claim); notice('Ocorrência confirmada pelo sistema.'); await renderQueue(); } catch (error) { notice(error.message, true); retry.disabled = !online; } }; card.append(retry); box.append(card);
    }
    if (selected) renderDetails(selected);
  }
  async function syncQueue() {
    if (syncing || !actor) return;
    syncing = true; await renderQueue(); const user = clone(actor);
    try {
      const count = await synchronize({user, currentUser: () => actor, store: storage, fetchSession: () => api('/api/session'), send, sessionReady: fresh => { session = fresh; }, progress: () => renderQueue()});
      await refresh(); notice(count ? `${count} registro(s) de entrega confirmado(s) pelo sistema.` : 'Não há comprovantes ou atualizações pendentes.');
    } catch (error) { notice(error instanceof TypeError ? 'Sem conexão com o sistema. Os registros continuam salvos neste aparelho.' : error.message, true); }
    finally { syncing = false; await renderQueue(); }
  }
  function selectedTrip() { const trip = view?.trips.find(t => t.id === selected); if (!trip) throw new Error('Selecione uma viagem disponível.'); return trip; }
  function selectedPackages() { return [...document.querySelectorAll('#packages input:checked:not(:disabled)')].map(x => x.value); }
  async function photoFor(file) {
    if (!file) return null;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 12 * 1024 * 1024) throw new Error('Selecione uma foto JPEG ou PNG de até 12 MB.');
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Não foi possível abrir a foto.')); i.src = url; });
      if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 16000000) throw new Error('Use uma foto de até 16 megapixels.');
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', .82).split(',')[1];
      if (base64.length > 2796200) throw new Error('A foto ainda é grande demais. Escolha uma imagem menor.');
      return base64;
    } finally { URL.revokeObjectURL(url); }
  }
  async function saveLocal(command, payload, photo) {
    const user = clone(actor), trip = selectedTrip(), record = makeRecord(user, trip, command, payload, photo);
    await storage.put(record);
    if (!sameUser(actor, user)) return;
    await renderQueue(); notice('Registro salvo neste aparelho. Sincronize para receber a confirmação do sistema.');
    if (online) await syncQueue();
  }
  async function transmitClaim(user, record) {
    return sendPendingClaim({user, currentUser: () => actor, record, fetchSession: () => api('/api/session'), sessionReady: fresh => { session = fresh; }, send, confirmed: () => storage.removeClaim(user)});
  }
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try {
      const result = await api('/api/login', {method: 'POST', body: {username: $('#username').value.trim(), password: $('#password').value}});
      authGeneration++; session = result; actor = result.user; $('#password').value = '';
      localStorage.removeItem('lince-driver-signed-out'); localStorage.setItem('lince-driver-actor', JSON.stringify({id: actor.id, org: actor.org, username: actor.username}));
      authenticatedWorkspace(); await refresh(); notice('Viagens atualizadas.');
    } catch (error) { notice(error.message, true); }
    finally { button.disabled = false; }
  });
  $('#logout').onclick = async () => {
    authGeneration++; const oldSession = session; actor = null; view = null; selected = null;
    localStorage.removeItem('lince-driver-actor'); localStorage.setItem('lince-driver-signed-out', '1');
    $('#workspace').hidden = true; $('#login-panel').hidden = false; $('#password').value = '';
    try { session = oldSession; await api('/api/logout', {method: 'POST'}); notice('Você saiu. As pendências não enviadas continuam guardadas para seu acesso.'); }
    catch { notice('Saída local concluída. Sem resposta do sistema para encerrar a sessão remota; as pendências não serão enviadas.', true); }
    finally { session = null; }
  };
  $('#refresh').onclick = async () => { try { await refresh(); notice('Viagens atualizadas.'); } catch (error) { notice(error.message, true); } };
  $('#back').onclick = () => { selected = null; document.body.classList.remove('driver-trip-open'); $('#details').hidden = true; $('#trips').scrollIntoView({behavior: 'smooth'}); };
  document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === button))); renderTrips(); });
  $('#stage').onclick = async () => {
    const button = $('#stage'); button.disabled = true;
    try {
      const trip = selectedTrip(); if (!online) throw new Error('Esta passagem exige conexão.');
      if (!confirm(`Conferiu todos os ${trip.packages.length} volumes para confirmar ${statusText[button.dataset.next]}?`)) return;
      await send('stage', {shipmentId: trip.id, version: trip.version, stage: button.dataset.next, packageKeys: trip.packages.map(p => p.key)}, `driver-stage-${trip.id}-${trip.version}-${button.dataset.next}`); await refresh(); notice('Passagem confirmada pelo sistema.');
    } catch (error) { notice(error.message, true); } finally { button.disabled = !online; }
  };
  $('#delivery-form').onsubmit = async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try {
      const trip = selectedTrip(), keys = selectedPackages(); if (!keys.length) throw new Error('Selecione pelo menos um volume ainda não entregue.');
      if (!$('#reason').value.trim()) throw new Error('Informe a observação da entrega ou o motivo do insucesso.');
      const photo = await photoFor($('#photo').files[0]);
      await saveLocal('pod', {shipmentId: trip.id, version: trip.version, proofId: `driver-${uuid()}`, packageKeys: keys, outcome: $('#outcome').value, reason: $('#reason').value.trim(), occurredAt: new Date().toISOString()}, photo);
      $('#photo').value = ''; $('#reason').value = '';
    } catch (error) { notice(error.message, true); } finally { button.disabled = false; }
  };
  $('#tracking-form').onsubmit = async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const trip = selectedTrip(); await saveLocal('tracking', {shipmentId: trip.id, eventId: `driver-${uuid()}`, type: $('#tracking-type').value, occurredAt: new Date().toISOString(), planVersion: trip.planVersion}); } catch (error) { notice(error.message, true); } finally { button.disabled = false; } };
  $('#claim-form').onsubmit = async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try {
      if (!online) throw new Error('A ocorrência exige conexão. Seu texto permanece no formulário.');
      const trip = selectedTrip(), user = clone(actor), keys = [...document.querySelectorAll('#claim-packages input:checked')].map(x => x.value), description = $('#claim-description').value.trim();
      if (!keys.length || !description) throw new Error('Selecione os volumes afetados e descreva a ocorrência.');
      const payload = {shipmentId: trip.id, packageKeys: keys, type: $('#claim-type').value, description};
      let record = await storage.claim(user);
      if (record && JSON.stringify(record.payload) !== JSON.stringify(payload)) throw new Error('Há uma ocorrência anterior sem confirmação. Confira o registro pendente antes de criar outra.');
      if (!record) { record = {owner: namespace(user), payload, key: `driver-claim-${uuid()}`, createdAt: new Date().toISOString()}; await storage.saveClaim(record); }
      await transmitClaim(user, record); $('#claim-description').value = ''; notice('Ocorrência registrada pelo sistema.');
    } catch (error) { notice(error.message, true); }
    finally { button.disabled = false; await renderQueue(); }
  };
  $('#sync').onclick = syncQueue;
  $('#persistent').onclick = async () => { const allowed = await navigator.storage?.persist?.(); notice(allowed ? 'O navegador concedeu armazenamento persistente. Limpar os dados do site ainda remove os registros locais.' : 'O navegador não concedeu persistência. Sincronize assim que possível.'); };
  root.addEventListener('online', () => { online = true; showConnection(); if (selected) renderDetails(selected); notice('Conexão disponível. Confira e sincronize os registros pendentes.'); });
  root.addEventListener('offline', () => { online = false; showConnection(); if (selected) renderDetails(selected); });
  root.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('#install').hidden = false; });
  $('#install').onclick = async () => { if (!installPrompt) return; await installPrompt.prompt(); installPrompt = null; $('#install').hidden = true; };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/driver/driver-sw.js', {scope: '/driver/'}).catch(() => notice('Não foi possível preparar a abertura sem conexão. O app continua disponível enquanto conectado.', true));
  (async () => {
    showConnection();
    if (localStorage.getItem('lince-driver-signed-out')) return;
    try {
      const result = await api('/api/session'); session = result; actor = result.user;
      localStorage.setItem('lince-driver-actor', JSON.stringify({id: actor.id, org: actor.org, username: actor.username})); authenticatedWorkspace(); await refresh();
    } catch (error) {
      if (!(error instanceof TypeError)) { notice(error.message, true); return; }
      try {
        const savedActor = JSON.parse(localStorage.getItem('lince-driver-actor') || 'null'); if (!savedActor) return;
        const cached = await storage.view(savedActor); if (!cached || !sameUser(cached.user, savedActor)) return;
        actor = savedActor; view = cached; session = null; online = false; authenticatedWorkspace(); showConnection(); renderTrips(); await renderQueue();
        notice('Modo sem conexão: dados da última consulta. Registros ficarão pendentes de autorização e sincronização.');
      } catch (localError) { notice(localError.message, true); }
    }
  })();
})(typeof globalThis !== 'undefined' ? globalThis : this);
