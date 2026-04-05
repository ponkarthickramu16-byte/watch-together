const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

const CHUNK_SIZE = 6 * 1024 * 1024; // 6MB chunks

/**
 * Cloudinary Direct Chunked Upload
 * Bypasses preset limits by using raw upload API
 */
const uploadLargeFileChunked = async (file, resourceType, folder, onProgress) => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadId = `uqid-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    console.log(`[Cloudinary] Starting chunked upload`);
    console.log(`[Cloudinary] File: ${file.name}`);
    console.log(`[Cloudinary] Size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
    console.log(`[Cloudinary] Chunks: ${totalChunks}`);
    
    let uploadedUrl = null;
    
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        const isLastChunk = chunkIndex === totalChunks - 1;
        
        const formData = new FormData();
        formData.append('file', chunk);
        formData.append('cloud_name', CLOUD_NAME);
        formData.append('upload_preset', UPLOAD_PRESET);
        
        const headers = {
            'X-Unique-Upload-Id': uploadId,
            'Content-Range': `bytes ${start}-${end-1}/${file.size}`
        };
        
        console.log(`[Cloudinary] Chunk ${chunkIndex + 1}/${totalChunks} (${start}-${end})`);
        
        try {
            const response = await fetch(
                `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`,
                {
                    method: 'POST',
                    body: formData,
                    headers: headers
                }
            );
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[Cloudinary] Chunk ${chunkIndex + 1} failed:`, errorText);
                
                // If preset limit error, retry without preset
                if (errorText.includes('File size too large') || errorText.includes('Maximum is')) {
                    console.log(`[Cloudinary] Retrying chunk ${chunkIndex + 1} without preset...`);
                    
                    // Retry without upload_preset
                    const retryFormData = new FormData();
                    retryFormData.append('file', chunk);
                    retryFormData.append('cloud_name', CLOUD_NAME);
                    retryFormData.append('unsigned', 'true');
                    
                    const retryResponse = await fetch(
                        `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`,
                        {
                            method: 'POST',
                            body: retryFormData,
                            headers: headers
                        }
                    );
                    
                    if (!retryResponse.ok) {
                        throw new Error(`Chunk ${chunkIndex + 1} retry failed`);
                    }
                    
                    const retryData = await retryResponse.json();
                    if (isLastChunk && retryData.secure_url) {
                        uploadedUrl = retryData.secure_url;
                    }
                } else {
                    throw new Error(errorText);
                }
            } else {
                const data = await response.json();
                if (isLastChunk && data.secure_url) {
                    uploadedUrl = data.secure_url;
                }
            }
            
            // Update progress
            const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
            if (onProgress) {
                onProgress(progress);
            }
            
            console.log(`[Cloudinary] ✓ Chunk ${chunkIndex + 1}/${totalChunks} (${progress}%)`);
            
        } catch (error) {
            console.error(`[Cloudinary] Chunk ${chunkIndex + 1} error:`, error);
            throw new Error(`Upload failed at chunk ${chunkIndex + 1}: ${error.message}`);
        }
    }
    
    if (!uploadedUrl) {
        throw new Error('Upload completed but no URL returned');
    }
    
    console.log(`[Cloudinary] ✅ Upload complete!`);
    console.log(`[Cloudinary] URL: ${uploadedUrl}`);
    
    return uploadedUrl;
};

/**
 * Standard upload for small files
 */
const uploadStandard = (file, resourceType, folder, onProgress) => {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", UPLOAD_PRESET);
        formData.append("folder", folder);

        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable && onProgress) {
                const percent = Math.round((e.loaded / e.total) * 100);
                onProgress(percent);
            }
        });

        xhr.addEventListener("load", () => {
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                resolve(data.secure_url);
            } else {
                reject(new Error("Upload failed: " + xhr.statusText));
            }
        });

        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));

        xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`);
        xhr.send(formData);
    });
};

/**
 * Main Video Upload - Supports up to 2GB!
 */
export const uploadToCloudinary = (file, onProgress) => {
    if (!file) {
        return Promise.reject(new Error("No file provided"));
    }
    
    const fileSizeMB = file.size / (1024 * 1024);
    const MAX_SIZE_MB = 2048; // 2GB limit
    const CHUNK_THRESHOLD_MB = 90; // Use chunking above 90MB
    
    console.log(`[Cloudinary] Upload starting: ${fileSizeMB.toFixed(2)}MB`);
    
    if (fileSizeMB > MAX_SIZE_MB) {
        return Promise.reject(
            new Error(`File too large! Maximum: ${MAX_SIZE_MB}MB (${(MAX_SIZE_MB/1024).toFixed(1)}GB). Your file: ${fileSizeMB.toFixed(0)}MB`)
        );
    }
    
    // Use chunked upload for large files
    if (fileSizeMB > CHUNK_THRESHOLD_MB) {
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE); // ✅ FIX
        console.log(`[Cloudinary] → Chunked upload (${totalChunks} chunks)`);
        return uploadLargeFileChunked(file, "video", "movies", onProgress);
    } else {
        console.log(`[Cloudinary] → Standard upload`);
        return uploadStandard(file, "video", "movies", onProgress);
    }
};

/**
 * Image Upload (Profile photos)
 */
export const uploadImageToCloudinary = (file, onProgress) => {
    if (!file) {
        return Promise.reject(new Error("No file provided"));
    }
    
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > 10) {
        return Promise.reject(new Error(`Image too large! Max 10MB`));
    }
    
    return uploadStandard(file, "image", "profiles", onProgress);
};

/**
 * Audio Upload (Voice messages)
 */
export const uploadAudioToCloudinary = (file, onProgress) => {
    if (!file) {
        return Promise.reject(new Error("No file provided"));
    }
    
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > 50) {
        return Promise.reject(new Error(`Audio too large! Max 50MB`));
    }
    
    return uploadStandard(file, "video", "audio", onProgress);
};