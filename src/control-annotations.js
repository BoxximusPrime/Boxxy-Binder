export const MAX_CONTROL_ANNOTATION_LENGTH = 160;

export function normalizeControlAnnotation(value)
{
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, MAX_CONTROL_ANNOTATION_LENGTH);
}

export function normalizeControlInputId(value)
{
    if (typeof value !== 'string') return '';

    const normalized = value.trim().toLowerCase();
    const modifierMatch = normalized.match(
        /^((?:kb|js|gp|mouse)\d*)_(?:(?:lalt|ralt|lctrl|rctrl|lshift|rshift|lwin|rwin)\+)+(.+)$/
    );

    return modifierMatch ? `${modifierMatch[1]}_${modifierMatch[2]}` : normalized;
}

export function buildControlAnnotationKey(scopeId, surfaceIndex, inputId, fallbackControlId = '')
{
    return JSON.stringify([
        String(scopeId || 'global'),
        Number.isInteger(surfaceIndex) ? surfaceIndex : 0,
        String(inputId || fallbackControlId || 'unknown')
    ]);
}

export function withControlAnnotation(annotations, key, value)
{
    const updated = annotations && typeof annotations === 'object' && !Array.isArray(annotations)
        ? { ...annotations }
        : {};
    const normalized = normalizeControlAnnotation(value);

    if (normalized)
    {
        updated[key] = normalized;
    }
    else
    {
        delete updated[key];
    }

    return updated;
}
