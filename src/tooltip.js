export class Tooltip
{
    // Static property to globally enable/disable all tooltips
    static enabled = true;

    constructor(element, text)
    {
        this.element = element;
        this.text = text;
        this.tooltip = null;

        this.element.addEventListener('mouseenter', this.show.bind(this));
        this.element.addEventListener('mouseleave', this.hide.bind(this));
    }

    show()
    {
        // Don't show if tooltips are globally disabled
        if (!Tooltip.enabled) return;
        if (this.element?.classList?.contains('tips-sensitive') && document.body.classList.contains('tips-hidden')) return;
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'custom-tooltip';
        this.tooltip.textContent = this.text;
        document.body.appendChild(this.tooltip);

        const rect = this.element.getBoundingClientRect();
        const tooltipRect = this.tooltip.getBoundingClientRect();

        // Position above the element
        let top = rect.top - tooltipRect.height - 10;
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

        let positionClass = 'tooltip-top';

        // Adjust if off screen
        if (top < 0)
        {
            top = rect.bottom + 10;
            positionClass = 'tooltip-bottom';
        }
        if (left < 0)
        {
            left = 10;
        }
        if (left + tooltipRect.width > window.innerWidth)
        {
            left = window.innerWidth - tooltipRect.width - 10;
        }

        // Calculate arrow position relative to the tooltip
        // We want the arrow to point at the center of the element
        const elementCenterX = rect.left + (rect.width / 2);
        const tooltipLeftEdge = left;
        const tooltipRightEdge = left + tooltipRect.width;

        // Arrow position as percentage from the left edge of the tooltip
        let arrowPercentage = 50; // default to center

        if (elementCenterX >= tooltipLeftEdge && elementCenterX <= tooltipRightEdge)
        {
            // Element center is within tooltip bounds, calculate percentage
            const elementOffsetInTooltip = elementCenterX - tooltipLeftEdge;
            arrowPercentage = (elementOffsetInTooltip / tooltipRect.width) * 100;
        }
        else if (elementCenterX < tooltipLeftEdge)
        {
            // Element is to the left, clamp arrow to left side (with padding)
            arrowPercentage = 15;
        }
        else
        {
            // Element is to the right, clamp arrow to right side (with padding)
            arrowPercentage = 85;
        }

        this.tooltip.classList.add(positionClass);
        this.tooltip.style.top = `${top}px`;
        this.tooltip.style.left = `${left}px`;
        this.tooltip.style.setProperty('--arrow-position', `${arrowPercentage}%`);

        // Trigger reflow to enable transition
        void this.tooltip.offsetWidth;

        this.tooltip.classList.add('visible');
    }

    hide()
    {
        if (this.tooltip)
        {
            this.tooltip.classList.remove('visible');
            // Remove after transition
            setTimeout(() =>
            {
                if (this.tooltip && !this.tooltip.classList.contains('visible'))
                {
                    this.tooltip.remove();
                    this.tooltip = null;
                }
            }, 200);
        }
    }
}
