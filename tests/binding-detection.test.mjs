import test from 'node:test';
import assert from 'node:assert/strict';

let moduleId = 0;

async function startCapture(t)
{
    t.mock.method(console, 'log', () => {});
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100000 });
    const handlers = new Map();
    const elements = new Map();
    const calls = [];
    const makeElement = () => ({
        style: {}, classList: { add() {}, remove() {} }, children: [],
        textContent: '', innerHTML: '', disabled: false,
        appendChild(child) { this.children.push(child); },
        querySelector() { return null; },
        addEventListener() {}, removeEventListener() {}, remove() {}
    });
    const previous = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
    t.after(() => Object.assign(globalThis, previous));
    globalThis.document = {
        getElementById(id)
        {
            if (!elements.has(id)) elements.set(id, makeElement());
            return elements.get(id);
        },
        createElement: makeElement,
        addEventListener() {}, removeEventListener() {}
    };
    globalThis.localStorage = { getItem() { return null; } };
    globalThis.window = {
        __TAURI__: {
            core: { invoke(command, args)
            {
                assert.equal(command, 'wait_for_inputs_with_events');
                calls.push(args);
                return new Promise(() => {});
            } },
            event: { async listen(name, handler)
            {
                handlers.set(name, handler);
                return () => handlers.delete(name);
            } },
            dialog: {}
        },
        addEventListener() {}, removeEventListener() {}
    };
    // Exercise the real capture handlers without a controller or a running Tauri window.
    await import(`../src/keybindings-page.js?capture-test=${moduleId++}`);
    await window.startBinding('spaceship_general', 'fire');
    const sessionId = calls[0].sessionId;
    return {
        elements, calls,
        async input(button, modifiers = [])
        {
            await handlers.get('input-detected')?.({ payload: {
                session_id: sessionId, input_string: `gp1_button${button}`,
                display_name: `Gamepad 1 - Button ${button}`, device_type: 'Gamepad',
                modifiers, is_modifier: button === 5
            } });
        },
        async complete()
        {
            await handlers.get('input-detection-complete')?.({ payload: { session_id: sessionId } });
        }
    };
}

for (const delay of [100, 3000])
{
    test(`captures LB+A when A follows LB after ${delay} ms`, async t =>
    {
        const capture = await startCapture(t);
        await capture.input(5);
        assert.equal(window.pendingBinding.mappedInput, 'gp1_shoulderl');
        assert.equal(capture.elements.get('binding-modal-save-btn').disabled, false);

        t.mock.timers.tick(delay);
        assert.equal(window.getIsDetectionActive(), true);
        await capture.input(1, ['SHOULDERL']);
        assert.equal(window.pendingBinding.mappedInput, 'gp1_shoulderl+a');
        t.mock.timers.tick(1001);
        assert.equal(window.getIsDetectionActive(), false);
    });
}

test('LB alone stays selectable when the initial capture timeout expires', async t =>
{
    const capture = await startCapture(t);
    await capture.input(5);
    t.mock.timers.tick(10000);
    await capture.complete();
    assert.equal(window.getIsDetectionActive(), false);
    assert.equal(window.pendingBinding.mappedInput, 'gp1_shoulderl');
    assert.equal(capture.elements.get('binding-modal-save-btn').disabled, false);
    assert.equal(capture.elements.get('binding-modal-countdown').textContent, '');
    assert.equal(capture.calls[0].deferModifiers, true);
});

test('ordinary buttons retain the one-second capture window', async t =>
{
    const capture = await startCapture(t);
    await capture.input(1);
    t.mock.timers.tick(1001);
    assert.equal(window.getIsDetectionActive(), false);
    assert.equal(window.pendingBinding.mappedInput, 'gp1_a');
});

test('cancelling while waiting for an LB combo removes the capture listeners', async t =>
{
    const capture = await startCapture(t);
    await capture.input(5);
    window.closeBindingModal();
    await capture.input(1, ['SHOULDERL']);
    t.mock.timers.tick(10000);
    assert.equal(window.getIsDetectionActive(), false);
    assert.equal(window.isBindingModalOpen(), false);
    assert.equal(capture.elements.get('binding-modal-save-btn').disabled, true);
    assert.equal(window.pendingBinding.mappedInput, 'gp1_shoulderl');
});
