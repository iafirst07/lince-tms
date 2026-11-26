(function () {
  'use strict';
  if (location.pathname !== '/') return;
  const node = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
  document.addEventListener('DOMContentLoaded', () => {
    const main = document.querySelector('main');
    if (!main) return;
    const panel = node('details'); panel.className = 'panel'; panel.style.marginTop = '22px';
    panel.append(node('summary', 'Receber evento de integração'));
    panel.append(node('p', 'Envie um evento e acompanhe a resposta do sistema. Ao repetir um envio, mantenha o mesmo identificador.'));
    const form = node('form'), grid = node('div'); grid.className = 'form-grid'; form.append(grid);
    function field(title, control) { const label = node('label', title); label.append(control); grid.append(label); return control; }
    const type = field('Tipo de evento', node('select'));
    for (const [value, text] of [['TRACKING', 'Atualização de rastreamento'], ['WMS', 'Custódia recebida do armazém'], ['ERP_ACK', 'Confirmação de conciliação']]) { const o = node('option', text); o.value = value; type.append(o); }
    const target = field('Viagem do cenário', node('select'));
    const eventId = field('Identificador do evento', node('input')); eventId.value = 'DEMO-' + crypto.randomUUID(); eventId.required = true;
    const reference = field('Referência da integração', node('input')); reference.value = 'RECEBIMENTO-2026'; reference.required = true;
    const refresh = node('button', 'Carregar viagens'); refresh.type = 'button'; refresh.className = 'secondary';
    const send = node('button', 'Enviar evento'); send.type = 'submit'; send.className = 'primary';
    const next = node('button', 'Novo evento'); next.type = 'button'; next.className = 'secondary';
    const output = node('p'); output.setAttribute('role', 'status'); output.setAttribute('aria-live', 'polite');
    form.append(refresh, send, next, output); panel.append(form); main.append(panel);
    let state = null, pending = null;
    async function load() {
      const response = await fetch('/api/state'); const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || data.error?.code || 'Não foi possível carregar o cenário.');
      const previousTarget = target.value; state = data; target.replaceChildren();
      for (const trip of data.objects.filter(o => o.kind === 'shipment' && o.status !== 'CANCELLED')) {
        const stop = trip.stops?.[0]; const option = node('option', `${stop?.destination?.name || 'Viagem'} · ${trip.stage || trip.status}`); option.value = trip.id; target.append(option);
      }
      if ([...target.options].some(o => o.value === previousTarget)) target.value = previousTarget;
      send.disabled = !(data.commands || []).includes('inbox_receive');
      if (send.disabled) output.textContent = 'Selecione um perfil de operação para receber integrações neste laboratório.';
      target.disabled = type.value === 'ERP_ACK';
    }
    form.addEventListener('input', () => { pending = null; target.disabled = type.value === 'ERP_ACK'; });
    refresh.onclick = () => load().then(() => { output.textContent = 'Viagens do cenário atualizadas.'; }).catch(e => { output.textContent = e.message; });
    next.onclick = () => { eventId.value = 'DEMO-' + crypto.randomUUID(); pending = null; output.textContent = 'Novo identificador preparado.'; };
    form.onsubmit = async event => {
      event.preventDefault(); if (!form.reportValidity()) return; send.disabled = true;
      try {
        if (!state) await load();
        if (!pending) {
          const trip = state.objects.find(o => o.id === target.value);
          if (type.value !== 'ERP_ACK' && !trip) throw new Error('Selecione uma viagem do cenário.');
          const payload = type.value === 'TRACKING' ? {shipmentId: trip.id, version: trip.version, planVersion: trip.planVersion, eventId: eventId.value, type: reference.value, occurredAt: new Date().toISOString()}
            : type.value === 'WMS' ? {shipmentId: trip.id, custody: 'READY'}
            : {entryIds: state.objects.filter(o => o.kind === 'ledger').map(o => o.id), reference: reference.value};
          pending = {eventId: eventId.value, type: type.value, payload};
        }
        const response = await fetch('/api/inbox', {method: 'POST', headers: {'Content-Type': 'application/json', 'Idempotency-Key': 'inbox-' + pending.eventId}, body: JSON.stringify(pending)});
        const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || result.error?.code || 'Recebimento não confirmado.');
        await load();
        output.textContent = `Recebimento: ${result.status || 'registrado'}. O registro e sua identidade foram preservados.`;
        document.querySelector('#refresh')?.click();
      } catch (error) { output.textContent = error.message + ' O evento permanece preparado para conferência ou repetição da mesma solicitação.'; }
      finally { send.disabled = false; }
    };
    panel.addEventListener('toggle', () => { if (panel.open && !state) load().catch(e => { output.textContent = e.message; }); });
  });
})();
