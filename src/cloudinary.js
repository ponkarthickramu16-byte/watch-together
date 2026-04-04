const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

// Cloudinary's chunked upload API (PROPER METHOD)
const CHUNK_SIZE = 6 * 1024 * 1024; // 6MB chunks (Cloudinary recommended)

/**
 * Cloudinary Chunked Upload (Proper Implementation)
 * 
 * This uses Cloudinary's official chunked upload API
 * which bypasses the 100MB upload preset limit
 */
const uploadLargeFileChunked = async (file, resourceType, folder, onProgress) => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const timestamp = Date.now();
    const publicId = `${folder}/${timestamp}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    
    console.log(`[Cloudinary] Chunked upload starting`);
    console.log(`[Cloudinary] File: ${file.name}, Size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
    console.log(`[Cloudinary] Total chunks: ${totalChunks}`);
    
    let uploadedUrl = null;
    
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        
        const formData = new FormData();
        formData.append('file', chunk);
        formData.append('upload_preset', UPLOAD_PRESET);
        formData.append('public_id', publicId);
        
        const contentRange = `bytes ${start}-${end - 1}/${file.size}`;
        
        console.log(`[Cloudinary] Uploading chunk ${chunkIndex + 1}/${totalChunks}`);
        
        try {
            const response = await fetch(
                `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`,
                {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'X-Unique-Upload-Id': `${timestamp}`,
                        'Content-Range': contentRange
                    }
                }
            );
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[Cloudinary] Chunk ${chunkIndex + 1} failed:`, errorText);
                throw new Error(`Chunk upload failed: ${errorText}`);
            }
            
            const data = await response.json();
            
            // Progress callback
            const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
            if (onProgress) {
                onProgress(progress);
            }
            
            console.log(`[Cloudinary] Chunk ${chunkIndex + 1}/${totalChunks} done (${progress}%)`);
            
            // Save URL from last chunk
            if (chunkIndex === totalChunks - 1) {
                uploadedUrl = data.secure_url;
                console.log(`[Cloudinary] Upload complete! URL: ${uploadedUrl}`);
            }
            
        } catch (error) {
            console.error(`[Cloudinary] Chunk ${chunkIndex + 1} error:`, error);
            throw new Error(`Upload failed at chunk ${chunkIndex + 1}: ${error.message}`);
        }
    }
    
    return uploadedUrl;
};

/**
 * Standard XHR Upload (for small files)
 */
const uploadWithXHR = (file, resourceType, folder, onProgress) => {
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
 * Main Video Upload Function
 * 
 * Strategy:
 * - Files ≤ 95MB: Standard upload (within Cloudinary preset limit)
 * - Files > 95MB: Chunked upload (bypasses preset limit)
 * - Max: 2GB
 */
export const uploadToCloudinary = (file, onProgress) => {
    if (!file) {
        return Promise.reject(new Error("No file provided"));
    }
    
    const fileSizeMB = file.size / (1024 * 1024);
    const MAX_SIZE_MB = 2048; // 2GB
    const CHUNK_THRESHOLD_MB = 95; // Use chunking above 95MB (safe margin)
    
    console.log(`[Cloudinary] File size: ${fileSizeMB.toFixed(2)}MB`);
    
    if (fileSizeMB > MAX_SIZE_MB) {
        return Promise.reject(
            new Error(`File too large! Max ${MAX_SIZE_MB}MB (${(MAX_SIZE_MB / 1024).toFixed(1)}GB). Your file: ${fileSizeMB.toFixed(0)}MB`)
        );
    }
    
    if (fileSizeMB > CHUNK_THRESHOLD_MB) {
        console.log(`[Cloudinary] Using CHUNKED upload (file > ${CHUNK_THRESHOLD_MB}MB)`);
        return uploadLargeFileChunked(file, "video", "movies", onProgress);
    } else {
        console.log(`[Cloudinary] Using STANDARD upload (file ≤ ${CHUNK_THRESHOLD_MB}MB)`);
        return uploadWithXHR(file, "video", "movies", onProgress);
    }
};

/**
 * Image Upload (Profile Photos)
 */
export const uploadImageToCloudinary = (file, onProgress) => {
    if (!file) {
        return Promise.reject(new Error("No file provided"));
    }
    
    const fileSizeMB = file.size / (1024 * 1024);
    const MAX_IMAGE_SIZE_MB = 10;
    
    if (fileSizeMB > MAX_IMAGE_SIZE_MB) {
        return Promise.reject(
            new Error(`Image too large! Max ${MAX_IMAGE_SIZE_MB}MB. Your image: ${fileSizeMB.toFixed(1)}MB`)
        );
    }
    
    return uploadWithXHR(file, "image", "profiles", onProgress);
};

/**
 * Audio Upload (Voice Messages)
 */
export const uploadAudioToCloudinary = (file, onProgress) => {
    if (!file) {
        return Promise.reject(new Error("No file provided"));
    }
    
    const fileSizeMB = file.size / (1024 * 1024);
    const MAX_AUDIO_SIZE_MB = 50;
    
    if (fileSizeMB > MAX_AUDIO_SIZE_MB) {
        return Promise.reject(
            new Error(`Audio too large! Max ${MAX_AUDIO_SIZE_MB}MB. Your audio: ${fileSizeMB.toFixed(1)}MB`)
        );
    }
    
    return uploadWithXHR(file, "video", "audio", onProgress);
};