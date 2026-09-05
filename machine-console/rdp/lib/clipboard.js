export function setupClipboard(builder, { ClipboardData, log, formatError }, state) {
    builder.remoteClipboardChangedCallback((clipboardData) => {
        state.setClipboardReady(true);
        try {
            if (clipboardData.isEmpty()) {
                log('Remote clipboard cleared', 'info');
                return;
            }
            const items = clipboardData.items();
            const mimeTypes = items.map(item => item.mimeType()).join(', ');
            log(`Remote clipboard changed: ${mimeTypes}`, 'info');
        } catch (e) {
            log(`Clipboard error: ${formatError(e)}`, 'error');
        }
    });

    builder.forceClipboardUpdateCallback(async () => {
        if (state.clipboardReady()) {
            return;
        }
        state.setClipboardReady(true);
        log('Clipboard channel ready (CLIPRDR initialized)', 'success');
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                const data = new ClipboardData();
                data.addText('text/plain', text);
                await state.session().onClipboardPaste(data);
                log('Local clipboard synced to remote', 'info');
            } else {
                const data = new ClipboardData();
                await state.session().onClipboardPaste(data);
            }
        } catch (e) {
            log(`Clipboard read failed, sending empty clipboard: ${formatError(e)}`, 'info');
            const data = new ClipboardData();
            await state.session().onClipboardPaste(data);
        }
    });
}
