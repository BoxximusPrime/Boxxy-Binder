import test from 'node:test';
import assert from 'node:assert/strict';

import
{
    addInputModifiers,
    getDetectedInputCandidates,
    getInputType,
    normalizeStarCitizenGamepadInput,
    parseInputDisplayName,
    toStarCitizenFormat
} from '../src/input-utils.js';

test('preserves detected modifiers when formatting template inputs', () =>
{
    const input = addInputModifiers(toStarCitizenFormat('gp2_button1'), ['SHOULDERL']);
    assert.equal(input, 'gp2_shoulderl+a');
    assert.equal(parseInputDisplayName(input), 'Left Shoulder + A');
    assert.equal(addInputModifiers('gp1_a', ['SHOULDERL', 'LCTRL', 'UNKNOWN']), 'gp1_lctrl+shoulderl+a');
    assert.equal(addInputModifiers('js2_rotz', ['LALT']), 'js2_lalt+rotz');
    assert.equal(addInputModifiers('gp1_shoulderl'), 'gp1_shoulderl');
});

const detected = (input_string, modifiers = []) => ({ input_string, modifiers });

test('a controller combo replaces its standalone LB candidate in either event order', () =>
{
    const lb = detected('gp1_button5');
    const combo = detected('gp1_button1', ['SHOULDERL']);
    assert.deepEqual(getDetectedInputCandidates([lb, combo]), [combo]);
    assert.deepEqual(getDetectedInputCandidates([combo, lb]), [combo]);
    assert.deepEqual(getDetectedInputCandidates([lb]), [lb]);
});

test('keeps unrelated inputs and LB from a different controller selectable', () =>
{
    const lb = detected('gp2_button5');
    const combo = detected('gp1_button1', ['SHOULDERL']);
    const a = detected('gp1_button1');
    const trigger1 = detected('js1_button1');
    const trigger2 = detected('js1_button2');
    assert.deepEqual(getDetectedInputCandidates([lb, combo]), [lb, combo]);
    assert.deepEqual(getDetectedInputCandidates([detected('gp1_button5'), a]), [detected('gp1_button5'), a]);
    assert.deepEqual(getDetectedInputCandidates([trigger1, trigger2]), [trigger1, trigger2]);
});

test('deduplicates repeated captures without merging plain and modified inputs', () =>
{
    const a = detected('gp1_button1');
    const combo = detected('gp1_button1', ['SHOULDERL']);
    assert.deepEqual(getDetectedInputCandidates([a, combo, combo]), [a, combo]);
});

test('converts XInput button numbers to Star Citizen gamepad tokens', () =>
{
    assert.equal(toStarCitizenFormat('gp1_button1'), 'gp1_a');
    assert.equal(toStarCitizenFormat('gp1_button3'), 'gp1_x');
    assert.equal(toStarCitizenFormat('gp1_button4'), 'gp1_y');
    assert.equal(toStarCitizenFormat('gp1_button7'), 'gp1_start');
    assert.equal(toStarCitizenFormat('gp1_button8'), 'gp1_back');
    assert.equal(toStarCitizenFormat('gp1_button11'), 'gp1_dpad_up');
    assert.equal(toStarCitizenFormat('gp1_button14'), 'gp1_dpad_right');
});

test('converts XInput axes for bindings and directional template slots', () =>
{
    assert.equal(toStarCitizenFormat('gp1_axis1_positive'), 'gp1_thumblx');
    assert.equal(toStarCitizenFormat('gp1_axis5_positive'), 'gp1_triggerl_btn');
    assert.equal(
        normalizeStarCitizenGamepadInput('gp1_axis1_positive', { preserveAxisDirection: true }),
        'gp1_thumbl_right'
    );
    assert.equal(
        normalizeStarCitizenGamepadInput('gp1_axis2_positive', { preserveAxisDirection: true }),
        'gp1_thumbl_up'
    );
});

test('keeps canonical face buttons and controller chords intact', () =>
{
    assert.equal(normalizeStarCitizenGamepadInput('gp1_x'), 'gp1_x');
    assert.equal(normalizeStarCitizenGamepadInput('gp1_y'), 'gp1_y');
    assert.equal(normalizeStarCitizenGamepadInput('gp1_shoulderl+x'), 'gp1_shoulderl+x');
    assert.equal(normalizeStarCitizenGamepadInput('gp2_shoulderl+button4'), 'gp2_shoulderl+y');
});

test('formats and classifies semantic gamepad inputs', () =>
{
    assert.equal(parseInputDisplayName('gp1_button11'), 'D-Pad Up');
    assert.equal(parseInputDisplayName('gp1_shoulderl+x'), 'Left Shoulder + X');
    assert.equal(parseInputDisplayName('gp1_hat1_up'), 'Hat 1 Up');
    assert.equal(getInputType('gp1_dpad_up'), 'button');
    assert.equal(getInputType('gp1_x'), 'button');
    assert.equal(getInputType('gp1_thumblx'), 'axis');
});
