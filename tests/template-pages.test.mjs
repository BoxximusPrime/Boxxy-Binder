import test from 'node:test';
import assert from 'node:assert/strict';

test('device creation, deletion, and a new template keep the editor selection in sync', async t =>
{
    const previous = { window: globalThis.window, document: globalThis.document };
    t.after(() => Object.assign(globalThis, previous));
    function element(tagName = 'DIV')
    {
        const listeners = new Map();
        return {
            tagName, style: {}, dataset: {}, children: [], value: '',
            classList: { add() {}, remove() {} },
            setAttribute() {},
            addEventListener(name, listener) { listeners.set(name, listener); },
            removeEventListener(name) { listeners.delete(name); },
            dispatchEvent(event) { return listeners.get(event.type)?.(event); },
            appendChild(child) { child.parentNode = this; this.children.push(child); },
            replaceChild(child, old) { this.children[this.children.indexOf(old)] = child; child.parentNode = this; },
            querySelector() { return element(); },
            querySelectorAll() { return []; }
        };
    }
    const elements = new Map([
        'template-pages-list', 'template-pages-empty', 'template-page-modal',
        'template-page-name', 'template-page-save-btn'
    ].map(id => [id, element()]));
    const prefixSelect = element('SELECT');
    prefixSelect.options = [{ value: 'gp1', textContent: 'gp1', selected: true }];
    prefixSelect.selectedIndex = 0;
    element().appendChild(prefixSelect);
    elements.set('template-page-prefix', prefixSelect);
    globalThis.document = {
        getElementById: id => elements.get(id) || null,
        createElement: tag => element(tag.toUpperCase()),
        addEventListener() {}, removeEventListener() {}
    };
    globalThis.window = { showConfirmation: async () => true };
    const { initializeTemplatePagesUI, refreshTemplatePagesUI, getTemplateV2State } =
        await import('../src/template-editor-v2.js');
    let template = { version: '1.1', pages: [] };
    let editorPageId = null;
    await initializeTemplatePagesUI({
        template,
        getTemplate: () => template,
        onPageSelected: id => { editorPageId = id; }
    });
    const addDevice = name =>
    {
        elements.get('template-page-name').value = name;
        getTemplateV2State().modalImageDataUrl = 'data:image/png;base64,test-image';
        elements.get('template-page-save-btn').dispatchEvent({ type: 'click' });
        const page = template.pages.at(-1);
        assert.equal(editorPageId, page.id, 'the button editor must receive the selected page');
        assert.equal(getTemplateV2State().selectedPageId, page.id);
        assert.equal(page.device_prefix, 'gp1');
        assert.equal(page.image_data_url, 'data:image/png;base64,test-image');
        return page;
    };

    const first = addDevice('Xbox Controller');
    first.buttons.push({ id: 1, name: 'A' });
    const second = addDevice('Second device');
    await window.deletePageWithConfirmation(second.id);
    assert.equal(editorPageId, first.id);
    assert.deepEqual(first.buttons, [{ id: 1, name: 'A' }]);
    await window.deletePageWithConfirmation(first.id);
    assert.equal(editorPageId, null);
    assert.equal(getTemplateV2State().selectedPageId, null);

    addDevice('Old template device');
    template = { version: '1.1', pages: [] };
    refreshTemplatePagesUI(template);
    assert.equal(editorPageId, null);
    addDevice('New template Xbox Controller');
});
