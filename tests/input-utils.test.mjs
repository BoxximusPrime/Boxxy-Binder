import test from 'node:test';
import assert from 'node:assert/strict';

import
{
    getInputType,
    normalizeStarCitizenGamepadInput,
    parseInputDisplayName,
    toStarCitizenFormat
} from '../src/input-utils.js';

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
