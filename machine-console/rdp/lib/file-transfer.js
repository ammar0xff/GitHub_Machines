export function createFileTransfer(getSession, { Extension, log, formatError, formatFileSize, escapeHtml }, state) {
    const { fileListEl, downloadBtn, uploadedFiles, pendingDownloads } = state;

    function addFileToList(name, size, status = 'queued') {
        const item = document.createElement('div');
        item.className = 'ft-item';
        item.innerHTML = `
            <span class="ft-item-name">${escapeHtml(name)}</span>
            <span class="ft-item-size">${formatFileSize(size)}</span>
            <span class="ft-item-status">${status}</span>
        `;
        fileListEl.appendChild(item);
        fileListEl.scrollTop = fileListEl.scrollHeight;
        return item;
    }

    function updateFileStatus(itemEl, status, isError = false) {
        const statusEl = itemEl.querySelector('.ft-item-status');
        statusEl.textContent = status;
        statusEl.className = 'ft-item-status' + (isError ? ' error' : status === 'downloading' ? ' downloading' : '');
    }

    const streamToFileInfo = new Map();

    function setupCallbacks(builder) {
        const filesAvailableCallback = new Extension('files_available_callback', (files, clipDataId) => {
            log(`Remote clipboard has ${files.length} file(s) available`, 'success');
            pendingDownloads.clear();
            streamToFileInfo.clear();
            downloadBtn.disabled = false;

            files.forEach((f, i) => {
                const itemEl = addFileToList(f.name || `file_${i}`, f.fileSize || 0, 'available');
                pendingDownloads.set(i, { ...f, clipDataId, _el: itemEl });
            });
        });
        builder.extension(filesAvailableCallback);

        const fileContentsRequestCallback = new Extension('file_contents_request_callback', async (request) => {
            log(`Remote requesting file contents: streamId=${request.streamId}, index=${request.index}, flags=${request.flags}`, 'info');

            const file = uploadedFiles.get(request.index);
            if (!file) {
                log(`File not found for index=${request.index}`, 'error');
                getSession().invokeExtension(new Extension('submit_file_contents', {
                    stream_id: request.streamId,
                    is_error: true,
                    data: new Uint8Array(0),
                }));
                return;
            }

            try {
                if (request.flags & 0x00000001) {
                    const sizeBytes = new Uint8Array(8);
                    const view = new DataView(sizeBytes.buffer);
                    view.setBigUint64(0, BigInt(file.size), true);
                    log(`Sending file size: ${file.size} bytes`, 'info');
                    getSession().invokeExtension(new Extension('submit_file_contents', {
                        stream_id: request.streamId,
                        is_error: false,
                        data: sizeBytes,
                    }));
                } else if (request.flags & 0x00000002) {
                    const start = request.position;
                    const length = request.size;
                    const blob = file.slice(start, start + length);
                    const buffer = await blob.arrayBuffer();
                    const data = new Uint8Array(buffer);
                    log(`Sending file data: ${data.length} bytes (offset=${start})`, 'info');
                    getSession().invokeExtension(new Extension('submit_file_contents', {
                        stream_id: request.streamId,
                        is_error: false,
                        data: data,
                    }));
                }
            } catch (e) {
                log(`Failed to read file: ${formatError(e)}`, 'error');
                getSession().invokeExtension(new Extension('submit_file_contents', {
                    stream_id: request.streamId,
                    is_error: true,
                    data: new Uint8Array(0),
                }));
            }
        });
        builder.extension(fileContentsRequestCallback);

        const fileContentsResponseCallback = new Extension('file_contents_response_callback', (response) => {
            const streamId = response.streamId;
            const fileInfo = streamToFileInfo.get(streamId);
            if (!fileInfo) {
                log(`File contents response for unknown file: streamId=${streamId}`, 'warn');
                return;
            }

            if (response.isError) {
                log(`✗ Failed to download ${fileInfo.name}: remote returned error`, 'error');
                streamToFileInfo.delete(streamId);
                return;
            }

            if (!fileInfo._chunks) {
                fileInfo._chunks = [];
                fileInfo._totalSize = 0;
            }

            if (response.data.length === 8 && !fileInfo._sizeReceived) {
                const view = new DataView(response.data.buffer);
                const fileSize = Number(view.getBigUint64(0, true));
                fileInfo._sizeReceived = true;
                fileInfo._expectedSize = fileSize;
                log(`File size confirmed: ${fileInfo.name} = ${fileSize} bytes`, 'info');

                const dataStreamId = streamId + 1000;
                streamToFileInfo.set(dataStreamId, fileInfo);

                const requestFileContentsExt = new Extension('request_file_contents', {
                    stream_id: dataStreamId,
                    file_index: fileInfo._fileIndex,
                    flags: 0x00000002,
                    position: 0,
                    size: fileSize,
                    clip_data_id: fileInfo.clipDataId,
                });
                getSession().invokeExtension(requestFileContentsExt);
            } else {
                fileInfo._chunks.push(new Uint8Array(response.data));
                fileInfo._totalSize += response.data.length;
                log(`Received ${fileInfo.name}: ${fileInfo._totalSize}/${fileInfo._expectedSize || '?'} bytes`, 'info');

                if (fileInfo._totalSize >= fileInfo._expectedSize) {
                    const blob = new Blob(fileInfo._chunks);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileInfo.name;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    log(`✓ Downloaded ${fileInfo.name} (${fileInfo._totalSize} bytes)`, 'success');
                    streamToFileInfo.delete(streamId);
                }
            }
        });
        builder.extension(fileContentsResponseCallback);

        const lockCallback = new Extension('lock_callback', (dataId) => {
            log(`Clipboard locked: dataId=${dataId}`, 'info');
        });
        builder.extension(lockCallback);

        const unlockCallback = new Extension('unlock_callback', (dataId) => {
            log(`Clipboard unlocked: dataId=${dataId}`, 'info');
        });
        builder.extension(unlockCallback);

        const locksExpiredCallback = new Extension('locks_expired_callback', (clipDataIds) => {
            log(`Clipboard locks expired: ${clipDataIds.length} lock(s)`, 'warn');
        });
        builder.extension(locksExpiredCallback);

        log('File transfer callbacks registered (via CLIPRDR channel)', 'success');
    }

    function setupUI(uploadBtn, fileInput, dropZone) {
        uploadBtn.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleUpload(Array.from(e.target.files));
            }
        });

        downloadBtn.addEventListener('click', handleDownload);

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                handleUpload(Array.from(e.dataTransfer.files));
            }
        });
    }

    async function handleUpload(files) {
        const sess = getSession();
        if (!sess) {
            log('File transfer not available', 'error');
            return;
        }

        log(`Uploading ${files.length} file(s) to remote desktop...`);

        try {
            const fileDescriptors = files.map((file, index) => {
                uploadedFiles.set(index, file);
                return {
                    name: file.name,
                    size: file.size,
                    lastModified: file.lastModified,
                };
            });

            const initiateFileCopyExt = new Extension('initiate_file_copy', fileDescriptors);
            sess.invokeExtension(initiateFileCopyExt);

            log(`Initiated file copy for ${files.length} file(s)`, 'success');

            files.forEach((file, index) => {
                const itemEl = addFileToList(file.name, file.size, 'uploading');
                updateFileStatus(itemEl, 'uploaded');
                log(`✓ Prepared ${file.name} for upload`, 'success');
            });
        } catch (err) {
            const errorMsg = formatError(err);
            log(`✗ Failed to initiate file copy: ${errorMsg}`, 'error');
            console.error('Upload error details:', err);
        }
    }

    function handleDownload() {
        const sess = getSession();
        if (!sess) {
            log('File transfer not available', 'error');
            return;
        }

        if (pendingDownloads.size === 0) {
            log('No files available for download. Files will appear when remote clipboard has content.', 'info');
            return;
        }

        log(`Requesting ${pendingDownloads.size} file(s) from remote desktop...`, 'info');

        pendingDownloads.forEach((fileInfo, index) => {
            updateFileStatus(fileInfo._el, 'downloading', false);

            try {
                const sizeStreamId = index + 1;
                const fileInfoWithIndex = { ...fileInfo, _fileIndex: index };
                streamToFileInfo.set(sizeStreamId, fileInfoWithIndex);

                const requestSizeExt = new Extension('request_file_contents', {
                    stream_id: sizeStreamId,
                    file_index: index,
                    flags: 0x00000001,
                    position: 0,
                    size: 8,
                    clip_data_id: fileInfo.clipDataId,
                });

                sess.invokeExtension(requestSizeExt);
                log(`Requesting size of: ${fileInfo.name || `file_${index}`}`, 'info');
            } catch (err) {
                updateFileStatus(itemEl, 'failed', true);
                const errorMsg = formatError(err);
                log(`✗ Failed to request ${fileInfo.name || `file_${index}`}: ${errorMsg}`, 'error');
                console.error('Download error details:', err);
            }
        });
    }

    function cleanup() {
        uploadedFiles.clear();
        pendingDownloads.clear();
        streamToFileInfo.clear();
        fileListEl.innerHTML = '';
        downloadBtn.disabled = true;
    }

    return { setupCallbacks, setupUI, handleUpload, handleDownload, cleanup };
}
