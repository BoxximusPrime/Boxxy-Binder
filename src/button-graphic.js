// Button graphic renderer for the template editor's button-details modal.
// Produces a centered SVG visualization of the input type with bound/unbound
// directional segments highlighted in the binding green.

const SVG_SIZE = 260;
const CENTER = SVG_SIZE / 2;

/**
 * Render the graphic for the given button type into the container.
 * @param {HTMLElement} container - target DIV.
 * @param {string} buttonType - supported template button type.
 * @param {object} button - the in-progress button (tempButton) with input state.
 */
export function RenderButtonGraphic(container, buttonType, button)
{
    if (!container)
    {
        return;
    }

    const bound = GetBoundMap(buttonType, button);
    const innerSvg = BuildSvgBody(buttonType, button, bound);
    container.innerHTML = `
        <div class="button-graphic-canvas">
            <svg viewBox="0 0 ${SVG_SIZE} ${SVG_SIZE}" class="button-graphic-svg" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <radialGradient id="bg-grad" cx="50%" cy="42%" r="62%">
                        <stop offset="0%" stop-color="#18212c" />
                        <stop offset="55%" stop-color="#0b1118" />
                        <stop offset="100%" stop-color="#04070c" />
                    </radialGradient>
                    <radialGradient id="face-grad" cx="50%" cy="35%" r="65%">
                        <stop offset="0%" stop-color="#353c47" />
                        <stop offset="45%" stop-color="#161c25" />
                        <stop offset="100%" stop-color="#070b11" />
                    </radialGradient>
                </defs>
                ${innerSvg}
            </svg>
        </div>
    `;
}

function BuildSvgBody(buttonType, button, bound)
{
    switch (buttonType)
    {
        case 'simple': return SimpleSvg(button, bound);
        case 'axis': return AxisSvg(button, bound);
        case 'hat4way': return Hat4WaySvg(bound);
        case 'hat2way-vertical': return Hat2VerticalSvg(bound);
        case 'hat2way-horizontal': return Hat2HorizontalSvg(bound);
        case 'toggle3way-vertical': return Toggle3VerticalSvg(bound);
        case 'toggle3way-horizontal': return Toggle3HorizontalSvg(bound);
        case 'rotary3way': return RotarySvg(3, bound);
        case 'rotary4way': return RotarySvg(4, bound);
        default: return '';
    }
}

function GetBoundMap(buttonType, button)
{
    const map = {};
    if (!button)
    {
        return map;
    }

    if (buttonType === 'simple' || buttonType === 'axis')
    {
        const hasInput = !!(
            button.input ||
            button.buttonId !== undefined && button.buttonId !== null ||
            (button.inputType && button.inputId !== undefined && button.inputId !== null) ||
            (button.inputs && typeof button.inputs.main !== 'undefined' && button.inputs.main !== null && button.inputs.main !== '')
        );
        map.main = hasInput;
        return map;
    }

    const inputs = (button.inputs && typeof button.inputs === 'object') ? button.inputs : {};
    for (const key of Object.keys(inputs))
    {
        if (inputs[key])
        {
            map[key] = true;
        }
    }
    return map;
}

function EscapeHtml(str)
{
    if (str === null || str === undefined)
    {
        return '';
    }
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ---------- Shared SVG building blocks ----------

function BackgroundRing()
{
    return `
        <circle cx="${CENTER}" cy="${CENTER}" r="120" fill="#05080d" stroke="rgba(255,255,255,0.08)" stroke-width="2" />
        <circle cx="${CENTER}" cy="${CENTER}" r="112" fill="url(#bg-grad)" stroke="rgba(0,0,0,0.75)" stroke-width="3" />
        <circle cx="${CENTER}" cy="${CENTER}" r="106" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
    `;
}

function CenterFace(radius, bound, label)
{
    const boundClass = bound ? ' bound' : '';
    const labelText = label
        ? `<text x="${CENTER}" y="${CENTER + 16}" text-anchor="middle" class="face-label slot-main${boundClass}">${EscapeHtml(label)}</text>`
        : '';
    return `
        <circle cx="${CENTER}" cy="${CENTER}" r="${radius}" fill="url(#face-grad)" class="btn-face slot-main${boundClass}" />
        ${labelText}
    `;
}

// Arrow key shape, oriented UP by default. Rotation applied via transform.
function ArrowKey(cx, cy, rotation, bound, slot)
{
    const cls = `arrow-key slot-${slot}` + (bound ? ' bound' : '');
    // Pentagon-shaped key pointing up with rounded base corners.
    const body = `M -26,18 L 26,18 Q 30,18 30,14 L 30,-4 L 0,-26 L -30,-4 L -30,14 Q -30,18 -26,18 Z`;
    const chevron = `M -10,4 L 0,-8 L 10,4`;
    return `
        <g transform="translate(${cx},${cy}) rotate(${rotation})" class="${cls}">
            <path d="${body}" class="arrow-body" />
            <path d="${chevron}" class="arrow-chevron" />
        </g>
    `;
}

// ---------- Per-type renderers ----------

function SimpleSvg(button, bound)
{
    // Prefer the actual detected button number when it exists.
    let label = '';
    if (button)
    {
        if (button.buttonId !== undefined && button.buttonId !== null)
        {
            label = String(button.buttonId);
        }
        else if (button.inputType === 'button' && typeof button.inputId === 'number')
        {
            label = String(button.inputId);
        }
        else if (typeof button.inputId === 'string')
        {
            const m = button.inputId.match(/\d+/);
            label = m ? m[0] : button.inputId.toUpperCase();
        }
        else if (typeof button.input === 'string')
        {
            const m = button.input.match(/(\d+)(?!.*\d)/);
            if (m)
            {
                label = m[1];
            }
        }
        else if (button.inputs && typeof button.inputs.main === 'string')
        {
            const m = button.inputs.main.match(/(\d+)(?!.*\d)/);
            if (m)
            {
                label = m[1];
            }
        }
    }

    return `
        ${BackgroundRing()}
        ${CenterFace(60, !!bound.main, label)}
    `;
}

function GetAxisGraphicLabel(button)
{
    if (!button)
    {
        return '';
    }

    const axisTokenMap = {
        x: 'X',
        y: 'Y',
        z: 'Z',
        rotx: 'RX',
        roty: 'RY',
        rotz: 'RZ',
        slider1: 'S1',
        slider2: 'S2'
    };

    const mainInput = typeof button.inputs?.main === 'string'
        ? button.inputs.main.toLowerCase()
        : (typeof button.input === 'string' ? button.input.toLowerCase() : '');

    if (mainInput)
    {
        const namedAxisMatch = mainInput.match(/_(x|y|z|rotx|roty|rotz|slider1|slider2)(?:$|_)/);
        if (namedAxisMatch)
        {
            return axisTokenMap[namedAxisMatch[1]] || namedAxisMatch[1].toUpperCase();
        }

        const numericAxisMatch = mainInput.match(/axis(\d+)/);
        if (numericAxisMatch)
        {
            return `A${numericAxisMatch[1]}`;
        }
    }

    if (button.inputType === 'axis' && button.inputId !== undefined && button.inputId !== null)
    {
        return typeof button.inputId === 'number'
            ? `A${button.inputId}`
            : String(button.inputId).toUpperCase();
    }

    return 'AX';
}

function AxisSvg(button, bound)
{
    const label = GetAxisGraphicLabel(button);
    const thumbWidth = Math.max(96, 34 + (label.length * 28));
    const thumbX = CENTER - (thumbWidth / 2);
    const trackClass = 'axis-track slot-main' + (bound.main ? ' bound' : '');
    const thumbClass = 'axis-thumb slot-main' + (bound.main ? ' bound' : '');
    const guideClass = 'axis-guide slot-main' + (bound.main ? ' bound' : '');
    const labelClass = 'axis-label slot-main' + (bound.main ? ' bound' : '');

    return `
        ${BackgroundRing()}
        <rect x="${CENTER - 20}" y="${CENTER - 78}" width="40" height="156" rx="20" class="${trackClass}" />
        <line x1="${CENTER}" y1="${CENTER - 62}" x2="${CENTER}" y2="${CENTER + 62}" class="${guideClass}" />
        <rect x="${thumbX}" y="${CENTER - 18}" width="${thumbWidth}" height="36" rx="18" class="${thumbClass}" />
        <text x="${CENTER}" y="${CENTER + 9}" text-anchor="middle" class="${labelClass}">${EscapeHtml(label)}</text>
    `;
}

function HatCenter(boundPush)
{
    if (boundPush)
    {
        return `<circle cx="${CENTER}" cy="${CENTER}" r="34" class="hat-center slot-push bound" />`;
    }

    return `<circle cx="${CENTER}" cy="${CENTER}" r="34" class="hat-center slot-push" />`;
}

function Hat4WaySvg(bound)
{
    const armOffset = 78;
    return `
        ${BackgroundRing()}
        ${HatCenter(!!bound.push)}
        ${ArrowKey(CENTER, CENTER - armOffset, 0, !!bound.up, 'up')}
        ${ArrowKey(CENTER + armOffset, CENTER, 90, !!bound.right, 'right')}
        ${ArrowKey(CENTER, CENTER + armOffset, 180, !!bound.down, 'down')}
        ${ArrowKey(CENTER - armOffset, CENTER, 270, !!bound.left, 'left')}
    `;
}

function Hat2VerticalSvg(bound)
{
    const armOffset = 78;
    return `
        ${BackgroundRing()}
        ${HatCenter(!!bound.push)}
        ${ArrowKey(CENTER, CENTER - armOffset, 0, !!bound.up, 'up')}
        ${ArrowKey(CENTER, CENTER + armOffset, 180, !!bound.down, 'down')}
    `;
}

function Hat2HorizontalSvg(bound)
{
    const armOffset = 78;
    return `
        ${BackgroundRing()}
        ${HatCenter(!!bound.push)}
        ${ArrowKey(CENTER + armOffset, CENTER, 90, !!bound.right, 'right')}
        ${ArrowKey(CENTER - armOffset, CENTER, 270, !!bound.left, 'left')}
    `;
}

function Toggle3VerticalSvg(bound)
{
    // Vertical toggle: 3 positions stacked, track running through them.
    const x = CENTER;
    const topY = CENTER - 70;
    const midY = CENTER;
    const botY = CENTER + 70;
    return `
        ${BackgroundRing()}
        <rect x="${x - 6}" y="${topY}" width="12" height="${botY - topY}" rx="6" class="toggle-track" />
        ${TogglePosition(x, topY, !!bound.up, 'vertical', 'up')}
        ${TogglePosition(x, midY, !!bound.middle, 'vertical', 'middle')}
        ${TogglePosition(x, botY, !!bound.down, 'vertical', 'down')}
    `;
}

function Toggle3HorizontalSvg(bound)
{
    const y = CENTER;
    const leftX = CENTER - 70;
    const midX = CENTER;
    const rightX = CENTER + 70;
    return `
        ${BackgroundRing()}
        <rect x="${leftX}" y="${y - 6}" width="${rightX - leftX}" height="12" rx="6" class="toggle-track" />
        ${TogglePosition(leftX, y, !!bound.left, 'horizontal', 'left')}
        ${TogglePosition(midX, y, !!bound.middle, 'horizontal', 'middle')}
        ${TogglePosition(rightX, y, !!bound.right, 'horizontal', 'right')}
    `;
}

function TogglePosition(cx, cy, bound, orientation, slot)
{
    const cls = `toggle-pos slot-${slot}` + (bound ? ' bound' : '');
    // Wider in the cross direction to suggest a detent plate.
    const w = orientation === 'vertical' ? 56 : 28;
    const h = orientation === 'vertical' ? 28 : 56;
    return `
        <rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="6" class="${cls}" />
    `;
}

function RotarySvg(positions, bound)
{
    const radius = 78;
    const dialRadius = 50;
    const dots = [];
    const positionKeys = positions === 3 ? ['2', '3', '1'] : ['1', '2', '3', '4'];

    // Distribute positions evenly around the dial starting from the top.
    for (let i = 0; i < positions; i++)
    {
        const angle = (-Math.PI / 2) + (i * (2 * Math.PI / positions));
        const cx = CENTER + radius * Math.cos(angle);
        const cy = CENTER + radius * Math.sin(angle);
        const positionKey = positionKeys[i];
        const isBound = !!bound[positionKey];
        const cls = `rotary-pos slot-${positionKey}` + (isBound ? ' bound' : '');
        const numCls = `rotary-pos-num slot-${positionKey}` + (isBound ? ' bound' : '');
        dots.push(`
            <g>
                <circle cx="${cx}" cy="${cy}" r="16" class="${cls}" />
                <text x="${cx}" y="${cy + 5}" text-anchor="middle" class="${numCls}">${positionKey}</text>
            </g>
        `);
    }

    // Indicator points to the first bound position, otherwise the first rendered position.
    let firstBoundIdx = -1;
    for (let i = 0; i < positions; i++)
    {
        if (bound[positionKeys[i]])
        {
            firstBoundIdx = i;
            break;
        }
    }
    const indicatorAngle = (-Math.PI / 2) + ((firstBoundIdx >= 0 ? firstBoundIdx : 0) * (2 * Math.PI / positions));
    const ix = CENTER + (dialRadius - 8) * Math.cos(indicatorAngle);
    const iy = CENTER + (dialRadius - 8) * Math.sin(indicatorAngle);

    const pushBound = !!bound.push;
    const pushGlow = pushBound
        ? `<circle cx="${CENTER}" cy="${CENTER}" r="${dialRadius + 8}" class="glow-ring" />`
        : '';
    const dialCls = 'rotary-dial slot-push' + (pushBound ? ' bound' : '');
    return `
        ${BackgroundRing()}
        ${pushGlow}
        <circle cx="${CENTER}" cy="${CENTER}" r="${dialRadius}" fill="url(#face-grad)" class="${dialCls}" />
        <line x1="${CENTER}" y1="${CENTER}" x2="${ix}" y2="${iy}" class="rotary-indicator${firstBoundIdx >= 0 ? ' bound' : ''}" />
        <circle cx="${CENTER}" cy="${CENTER}" r="6" class="rotary-hub" />
        ${dots.join('')}
    `;
}
