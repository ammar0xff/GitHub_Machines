export function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function createLogger(logEl, statusEl) {
    function log(message, type = 'info') {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        const entry = document.createElement('div');
        entry.className = `log-entry log-${type}`;
        entry.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(message)}`;
        logEl.appendChild(entry);
        logEl.scrollTop = logEl.scrollHeight;
        console.log(`[${type.toUpperCase()}] ${message}`);
    }

    function setStatus(text, state) {
        statusEl.textContent = text;
        statusEl.className = `status-${state}`;
    }

    function formatError(e) {
        if (e && typeof e === 'object' && '__wbg_ptr' in e) {
            try {
                const kindNames = {
                    0: 'General', 1: 'WrongPassword', 2: 'LogonFailure',
                    3: 'AccessDenied', 4: 'RDCleanPath', 5: 'ProxyConnect',
                    6: 'NegotiationFailure',
                };
                const kind = e.kind ? e.kind() : 'Unknown';
                const bt = e.backtrace ? e.backtrace() : '';
                return `[${kindNames[kind] || kind}] ${bt}`;
            } catch (_) {}
        }
        return e?.message || e?.toString() || String(e);
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    return { log, setStatus, formatError, formatFileSize };
}
