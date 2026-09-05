import { setupClipboard } from './clipboard.js';
import { setupInputHandlers } from './input.js';
import { createFileTransfer } from './file-transfer.js';

export function createSessionManager({
    canvas, statusEl, connectBtn, disconnectBtn, fileTransferPanel,
    uploadBtn, downloadBtn, fileInput, dropZone, fileListEl,
    hostInput, usernameInput, passwordInput,
    SessionBuilder, DesktopSize, Extension, DeviceEvent, InputTransaction, ClipboardData,
    init, setup, log, setStatus, formatError
}) {
    let session = null;
    let clipboardReady = false;
    const pendingDownloads = new Map();
    const uploadedFiles = new Map();

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const fileTransfer = createFileTransfer(
        () => session,
        { Extension, log, formatError, formatFileSize, escapeHtml },
        { fileListEl, downloadBtn, uploadedFiles, pendingDownloads }
    );

    async function connect() {
        try {
            const destination = hostInput.value || '192.168.2.31:3389';
            const username = usernameInput.value || 'zxd';
            const password = passwordInput.value || 'zxd';

            const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const proxyAddress = `${wsProtocol}//${location.host}`;

            await init();
            setup('info');
            log('WASM module initialized', 'success');

            setStatus('Connecting...', 'connecting');
            connectBtn.disabled = true;

            log(`Connecting to ${destination} via proxy ${proxyAddress}`);
            log(`User: ${username}`);

            const desktopSize = new DesktopSize(1280, 720);
            const enableCredsspExt = new Extension('enable_credssp', true);

            const builder = new SessionBuilder();
            builder.username(username);
            builder.password(password);
            builder.destination(destination);
            builder.proxyAddress(proxyAddress);
            builder.authToken('none');
            builder.desktopSize(desktopSize);
            builder.renderCanvas(canvas);
            builder.extension(enableCredsspExt);

            fileTransfer.setupCallbacks(builder);

            setupClipboard(builder, { ClipboardData, log, formatError }, {
                session: () => session,
                clipboardReady: () => clipboardReady,
                setClipboardReady: (v) => { clipboardReady = v; }
            });

            builder.setCursorStyleCallbackContext(canvas);
            builder.setCursorStyleCallback(function(style) {
                canvas.style.cursor = style || 'default';
            });

            log('Initiating RDP connection...');
            session = await builder.connect();

            const ds = session.desktopSize();
            log(`Connected! Desktop: ${ds.width}x${ds.height}`, 'success');
            canvas.width = ds.width;
            canvas.height = ds.height;

            setStatus(`Connected (${ds.width}×${ds.height})`, 'connected');
            disconnectBtn.disabled = false;
            canvas.focus();

            fileTransferPanel.classList.add('visible');
            uploadBtn.disabled = false;
            log('File transfer panel enabled', 'success');

            setupInputHandlers(canvas, session, { DeviceEvent, InputTransaction }, log);
            fileTransfer.setupUI(uploadBtn, fileInput, dropZone);

            session.run().then((info) => {
                log(`Session ended: ${info.reason()}`, 'warn');
                cleanup();
            }).catch((e) => {
                log(`Session error: ${formatError(e)}`, 'error');
                cleanup();
            });

        } catch (e) {
            log(`Connection failed: ${formatError(e)}`, 'error');
            cleanup();
            throw e;
        }
    }

    function disconnect() {
        if (session) {
            try {
                session.shutdown();
                log('Disconnected by user', 'warn');
            } catch (e) {
                log(`Disconnect error: ${formatError(e)}`, 'error');
            }
        }
        cleanup();
    }

    function cleanup() {
        session = null;
        clipboardReady = false;
        uploadedFiles.clear();
        pendingDownloads.clear();
        setStatus('Disconnected', 'disconnected');
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
        fileTransferPanel.classList.remove('visible');
        uploadBtn.disabled = true;
        downloadBtn.disabled = true;
        fileListEl.innerHTML = '';
    }

    return { connect, disconnect, cleanup };
}
