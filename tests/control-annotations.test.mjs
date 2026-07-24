import test from 'node:test';
import assert from 'node:assert/strict';

import
{
    MAX_CONTROL_ANNOTATION_LENGTH,
    buildControlAnnotationKey,
    normalizeControlAnnotation,
    normalizeControlInputId,
    withControlAnnotation
} from '../src/control-annotations.js';

test('normalizes and limits custom control notes', () =>
{
    assert.equal(normalizeControlAnnotation('  R Ctrl via JoyToKey  '), 'R Ctrl via JoyToKey');
    assert.equal(normalizeControlAnnotation(null), '');
    assert.equal(
        normalizeControlAnnotation('x'.repeat(MAX_CONTROL_ANNOTATION_LENGTH + 10)).length,
        MAX_CONTROL_ANNOTATION_LENGTH
    );
});

test('normalizes bindings to their physical input for device-agnostic notes', () =>
{
    assert.equal(normalizeControlInputId('KB1_LALT+W'), 'kb1_w');
    assert.equal(normalizeControlInputId('js2_lctrl+lshift+button31'), 'js2_button31');
    assert.equal(normalizeControlInputId('mouse1_ralt+button2'), 'mouse1_button2');
    assert.equal(normalizeControlInputId('gp1_shoulderl+x'), 'gp1_shoulderl+x');
});

test('annotation keys distinguish device scopes, surfaces, and inputs', () =>
{
    const base = buildControlAnnotationKey('template:Virpil.json', 0, 'js1_button31');
    assert.notEqual(base, buildControlAnnotationKey('template:Virpil.json', 1, 'js1_button31'));
    assert.notEqual(base, buildControlAnnotationKey('template:Virpil.json', 0, 'js1_button32'));
    assert.notEqual(base, buildControlAnnotationKey('device:keyboard', 0, 'js1_button31'));
});

test('saving an empty note removes the annotation without mutating the source', () =>
{
    const key = buildControlAnnotationKey('template:Virpil.json', 0, 'js1_button31');
    const original = { [key]: 'R Ctrl' };
    const cleared = withControlAnnotation(original, key, '   ');

    assert.equal(original[key], 'R Ctrl');
    assert.equal(cleared[key], undefined);
    assert.equal(withControlAnnotation({}, key, '  Trim Reset  ')[key], 'Trim Reset');
});
