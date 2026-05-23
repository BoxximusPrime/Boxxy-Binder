// ============================================================================
// Shared Physical Input Type Rendering
// ============================================================================
// This module provides consistent multi-input (directional) box layouts for
// various physical controls (toggle switches, rotary switches, hats, etc.).
//
// It is intentionally renderer-only: callers supply callbacks for content lines,
// clickable registration, and mode-specific behavior.

import
{
    HatFrameWidth,
    HatFrameHeight,
    HatSpacing,
    HatTitleFontSize,
    getButtonFrameWidth,
    getButtonFrameHeight,
    simplifyButtonName,
    DrawButtonFrame,
    drawButtonBox
} from './button-renderer.js';

// ========================================
// Helpers
// ========================================

function normalizeFontSizePx(fontSize)
{
    if (!fontSize) return null;
    return typeof fontSize === 'number' ? `${fontSize}px` : fontSize;
}

function defaultDirectionLabel(direction)
{
    // Toggle
    if (direction === 'up') return 'Up';
    if (direction === 'down') return 'Down';
    if (direction === 'left') return '◄';
    if (direction === 'right') return '►';
    if (direction === 'middle') return 'Mid';

    // Rotary
    if (direction === 'push') return 'Push';

    // Numeric positions
    if (typeof direction === 'string' && /^\d+$/.test(direction))
    {
        return direction;
    }

    // Fallback
    return String(direction || '').toUpperCase().slice(0, 4) || '?';
}

function drawClusterTitle(ctx, name, centerX, titleY, titleFontSize, titleColor)
{
    ctx.fillStyle = titleColor || '#aaa';
    ctx.font = `${normalizeFontSizePx(titleFontSize) || HatTitleFontSize} "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(simplifyButtonName(name || 'Input'), centerX, titleY);
}

// ========================================
// 3-Way Toggle (Vertical / Horizontal)
// ========================================

export function getToggle3WayPositions(centerX, centerY, orientation = 'vertical', width = HatFrameWidth, height = HatFrameHeight)
{
    const positions = {};

    if (orientation === 'horizontal')
    {
        const horizontalOffset = width + HatSpacing;
        positions.left = { x: centerX - horizontalOffset, y: centerY };
        positions.middle = { x: centerX, y: centerY };
        positions.right = { x: centerX + horizontalOffset, y: centerY };
    }
    else
    {
        const verticalOffset = height + HatSpacing;
        positions.up = { x: centerX, y: centerY - verticalOffset };
        positions.middle = { x: centerX, y: centerY };
        positions.down = { x: centerX, y: centerY + verticalOffset };
    }

    return positions;
}

export function drawToggle3WayBoxes(ctx, toggle, options = {})
{
    const {
        mode = 'template',
        alpha = 1,
        orientation = 'vertical',
        getContentForDirection = null,
        colors = {},
        onClickableBox = null,
        buttonDataForDirection = null,
        bindingsByDirection = null,
        isTemplateEditor = false,
        hatFrameWidth = getButtonFrameWidth(toggle, HatFrameWidth),
        hatFrameHeight = getButtonFrameHeight(toggle, HatFrameHeight),
        numLines = null,
        titleFontSize = null,
        contentFontSize = null,
        directionLabel = defaultDirectionLabel
    } = options;

    ctx.save();
    ctx.globalAlpha = alpha;

    const positions = getToggle3WayPositions(toggle.labelPos.x, toggle.labelPos.y, orientation, hatFrameWidth, hatFrameHeight);

    // Title above the top-most box
    const ys = Object.values(positions).map(p => p.y);
    const topY = Math.min(...ys);
    const titleY = topY - hatFrameHeight / 2 - 12;
    drawClusterTitle(ctx, toggle.name || 'Toggle', toggle.labelPos.x, titleY, titleFontSize, colors.titleColor);

    const directions = orientation === 'horizontal' ? ['left', 'middle', 'right'] : ['up', 'middle', 'down'];

    directions.forEach(dir =>
    {
        const pos = positions[dir];
        const input = toggle.inputs ? toggle.inputs[dir] : null;
        const label = directionLabel(dir);

        if (mode === 'template')
        {
            // In template mode, always draw all direction boxes
            const contentLines = (input && getContentForDirection) ? (getContentForDirection(dir, input) || []) : [];
            DrawButtonFrame(ctx, pos.x, pos.y, label, contentLines, true, alpha, colors, isTemplateEditor, { hatFrameWidth, hatFrameHeight });
            return;
        }

        // In viewer mode, skip directions that have no input
        if (!input)
        {
            return;
        }

        const contentLines = getContentForDirection ? (getContentForDirection(dir, input) || []) : [];
        const actualBindings = bindingsByDirection ? bindingsByDirection[dir] : null;
        drawButtonBox(ctx, pos.x, pos.y, label, contentLines, true, {
            hasBinding: contentLines.length > 0,
            buttonData: buttonDataForDirection ? buttonDataForDirection(dir) : null,
            mode,
            onClickableBox,
            titleColor: colors.titleColor || '#ccc',
            contentColor: colors.contentColor || '#ddd',
            subtleColor: colors.subtleColor || '#999',
            mutedColor: colors.mutedColor || '#666',
            actionColor: colors.actionColor || null,
            boxColor: colors.boxColor || null,
            bindingsData: actualBindings || contentLines,
            hatFrameWidth,
            hatFrameHeight,
            numLines,
            titleFontSize: normalizeFontSizePx(titleFontSize),
            contentFontSize: normalizeFontSizePx(contentFontSize)
        });
    });

    ctx.restore();
}

// ========================================
// Rotary (3-way / 4-way) with optional push
// ========================================

export function getRotaryPositions(centerX, centerY, steps = 4, includePush = false, width = HatFrameWidth, height = HatFrameHeight)
{
    const positions = {};
    const hSpace = width + HatSpacing;
    const vSpace = height + HatSpacing;
    const gap = includePush ? HatSpacing : 90;
    const hSpaceWithGap = width + gap;

    if (steps === 3)
    {
        // Row 1: [1] (centered)
        positions['1'] = { x: centerX, y: centerY - vSpace / 2 };

        // Row 2: [2] ([Push]) [3]
        const row2Y = centerY + vSpace / 2;
        if (includePush)
        {
            positions['2'] = { x: centerX - hSpace, y: row2Y };
            positions['push'] = { x: centerX, y: row2Y };
            positions['3'] = { x: centerX + hSpace, y: row2Y };
        }
        else
        {
            positions['2'] = { x: centerX - hSpaceWithGap / 2, y: row2Y };
            positions['3'] = { x: centerX + hSpaceWithGap / 2, y: row2Y };
        }
    }
    else if (steps === 4)
    {
        // Row 1: [1] [2]
        const row1Y = centerY - vSpace / 2;
        positions['1'] = { x: centerX - hSpace / 2, y: row1Y };
        positions['2'] = { x: centerX + hSpace / 2, y: row1Y };

        // Row 2: [3] ([Push]) [4]
        const row2Y = centerY + vSpace / 2;
        if (includePush)
        {
            positions['3'] = { x: centerX - hSpace, y: row2Y };
            positions['push'] = { x: centerX, y: row2Y };
            positions['4'] = { x: centerX + hSpace, y: row2Y };
        }
        else
        {
            positions['3'] = { x: centerX - hSpaceWithGap / 2, y: row2Y };
            positions['4'] = { x: centerX + hSpaceWithGap / 2, y: row2Y };
        }
    }
    else
    {
        // Fallback to ellipse for other step counts
        const rx = width + HatSpacing;
        const ry = height + HatSpacing;
        const startAngle = -Math.PI / 2;

        for (let i = 0; i < steps; i++)
        {
            const angle = startAngle + (i * (2 * Math.PI / steps));
            const x = centerX + Math.cos(angle) * rx;
            const y = centerY + Math.sin(angle) * ry;
            positions[String(i + 1)] = { x, y };
        }

        if (includePush)
        {
            positions.push = { x: centerX, y: centerY };
        }
    }

    return positions;
}

export function drawRotaryBoxes(ctx, rotary, options = {})
{
    const {
        mode = 'template',
        alpha = 1,
        steps = 4,
        includePush = false,
        getContentForDirection = null,
        colors = {},
        onClickableBox = null,
        buttonDataForDirection = null,
        bindingsByDirection = null,
        isTemplateEditor = false,
        hatFrameWidth = getButtonFrameWidth(rotary, HatFrameWidth),
        hatFrameHeight = getButtonFrameHeight(rotary, HatFrameHeight),
        numLines = null,
        titleFontSize = null,
        contentFontSize = null,
        directionLabel = defaultDirectionLabel
    } = options;

    ctx.save();
    ctx.globalAlpha = alpha;

    const hasPush = includePush && rotary.inputs && rotary.inputs.push;
    const positions = getRotaryPositions(rotary.labelPos.x, rotary.labelPos.y, steps, hasPush, hatFrameWidth, hatFrameHeight);

    // Title above the top-most box (or center)
    const ys = Object.values(positions).map(p => p.y);
    const topY = Math.min(...ys);
    const titleY = topY - hatFrameHeight / 2 - 12;
    drawClusterTitle(ctx, rotary.name || 'Rotary', rotary.labelPos.x, titleY, titleFontSize, colors.titleColor);

    const directions = [];
    for (let i = 1; i <= steps; i++) directions.push(String(i));
    if (hasPush) directions.push('push');

    directions.forEach(dir =>
    {
        const pos = positions[dir];
        // For push, only draw if it actually has an input (optional)
        const input = rotary.inputs ? rotary.inputs[dir] : null;
        const label = directionLabel(dir);

        if (mode === 'template')
        {
            // In template mode: always draw numbered positions, but push only if bound
            if (dir === 'push' && !input)
            {
                return; // Skip push if not bound in template mode
            }
            const contentLines = (input && getContentForDirection) ? (getContentForDirection(dir, input) || []) : [];
            DrawButtonFrame(ctx, pos.x, pos.y, label, contentLines, true, alpha, colors, isTemplateEditor, { hatFrameWidth, hatFrameHeight });
            return;
        }

        // In viewer mode, skip directions that have no input
        if (!input)
        {
            return;
        }

        const contentLines = getContentForDirection ? (getContentForDirection(dir, input) || []) : [];
        const actualBindings = bindingsByDirection ? bindingsByDirection[dir] : null;
        drawButtonBox(ctx, pos.x, pos.y, label, contentLines, true, {
            hasBinding: contentLines.length > 0,
            buttonData: buttonDataForDirection ? buttonDataForDirection(dir) : null,
            mode,
            onClickableBox,
            titleColor: colors.titleColor || '#ccc',
            contentColor: colors.contentColor || '#ddd',
            subtleColor: colors.subtleColor || '#999',
            mutedColor: colors.mutedColor || '#666',
            actionColor: colors.actionColor || null,
            boxColor: colors.boxColor || null,
            bindingsData: actualBindings || contentLines,
            hatFrameWidth,
            hatFrameHeight,
            numLines,
            titleFontSize: normalizeFontSizePx(titleFontSize),
            contentFontSize: normalizeFontSizePx(contentFontSize)
        });
    });

    ctx.restore();
}
