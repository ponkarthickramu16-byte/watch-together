const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

// Chunk size: 10MB per chunk (optimal for most networks)
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Chunked Upload for Large Files (Up to 2GB)
 * 
 * How it works:
 * 1. Split file into 10MB chunks
 * 2. Upload each chunk sequentially
 * 3. Cloudinary automatically assembles them
 * 4. Progress callback for real-time updates
 */
const uploadLargeFile = async (file, resourceType, folder, onProgress) => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uniqueUploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    console.log(`[Cloudinary] Starting chunked upload: ${file.name}`);
    console.log(`[Cloudinary] File size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
    console.log(`[Cloudinary] Total chunks: ${totalChunks}`);
    
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        
        const formData = new FormData();
        // Preserve original filename for better backend asset identification.
        formData.append("file", chunk, file.name);
        formData.append("upload_preset", UPLOAD_PRESET);
        formData.append("folder", folder);
        // Ensure Cloudinary applies the correct upload preset rules (max file size, formats, etc).
        formData.append("resource_type", resourceType);
        formData.append("public_id", uniqueUploadId);
        
        // Chunk metadata
        const contentRange = `bytes ${start}-${end - 1}/${file.size}`;
        
        console.log(`[Cloudinary] Uploading chunk ${chunkIndex + 1}/${totalChunks} (${contentRange})`);
        
        try {
            const response = await fetch(
                // Cloudinary client-side chunked upload examples use `auto/upload`.
                // Using `video/upload` can cause Cloudinary to validate differently for chunked requests.
                `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`,
                {
                    method: "POST",
                    body: formData,
                    headers: {
                        "X-Unique-Upload-Id": uniqueUploadId,
                        "Content-Range": contentRange
                    }
                }
            );
            
            if (!response.ok) {
                const errorText = await response.text();
                // Cloudinary returns detailed JSON in `errorText` for validation issues.
                // Example: File size too large. Got ... Maximum is 104857600.
                throw new Error(
                    `Chunk ${chunkIndex + 1} upload failed: ${errorText}`
                );
            }
            
            const data = await response.json();
            
            // Calculate overall progress
            const overallProgress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
            if (onProgress) {
                onProgress(overallProgress);
            }
            
            console.log(`[Cloudinary] Chunk ${chunkIndex + 1}/${totalChunks} uploaded successfully (${overallProgress}%)`);
            
            // Last chunk - return the final URL
            if (chunkIndex === totalChunks - 1) {
                console.log(`[Cloudinary] Upload complete! URL: ${data.secure_url}`);
                return data.secure_url;
            }
            
        } catch (error) {
            console.error(`[Cloudinary] Chunk ${chunkIndex + 1} upload error:`, error);
            // Make Cloudinary "max file size" issues obvious to the user.
            const msg = error?.message || String(error);
            if (msg.includes("File size too large") || msg.includes("Maximum is 104857600")) {
                throw new Error(
                    `Cloudinary rejected the upload: file exceeds your current Cloudinary upload limit (100MB in this case). ` +
                    `Fix: update your Cloudinary upload preset/max file size (the preset referenced by VITE_CLOUDINARY_UPLOAD_PRESET) or upgrade your plan. ` +
                    `Details: ${msg}`
                );
            }
            throw new Error(`Upload failed at chunk ${chunkIndex + 1}/${totalChunks}: ${msg}`);
        }
    }
};

// Standard upload for small files (< 100MB)
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

        xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
        xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));

        xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`);
        xhr.send(formData);
    });
};

/**
 * 🎬 Movie / Video upload with smart routing
 * - Files > 100MB → Chunked upload
 * - Files ≤ 100MB → Standard upload
 * Maximum file size: 2GB (2048MB)
 */
export const uploadToCloudinary = (file, onProgress) => {
    // Validate file
    if (!file) {
        return Promise.reject(new Error("No file provided"));
    }
    
    // Check file size
    const fileSizeMB = file.size / (1024 * 1024);
    const MAX_SIZE_MB = 2048; // 2GB
    const CHUNK_THRESHOLD_MB = 100; // Use chunking for files > 100MB
    
    console.log(`[Cloudinary] File size: ${fileSizeMB.toFixed(2)}MB`);
    
    if (fileSizeMB > MAX_SIZE_MB) {
        return Promise.reject(
            new Error(`File too large! Maximum size is ${MAX_SIZE_MB}MB (${(MAX_SIZE_MB / 1024).toFixed(1)}GB). Your file: ${fileSizeMB.toFixed(0)}MB`)
        );
    }
    
    // Choose upload method based on file size
    if (fileSizeMB > CHUNK_THRESHOLD_MB) {
        console.log(`[Cloudinary] Using chunked upload (file > ${CHUNK_THRESHOLD_MB}MB)`);
        return uploadLargeFile(file, "video", "movies", onProgress);
    } else {
        console.log(`[Cloudinary] Using standard upload (file ≤ ${CHUNK_THRESHOLD_MB}MB)`);
        return uploadWithXHR(file, "video", "movies", onProgress);
    }
};

/**
 * 📸 Profile Photo / Image upload
 * Images are typically small, so standard upload is fine
 */
export const uploadImageToCloudinary = (file, onProgress) => {
    if (!file) {
        return Promise.reject(new Error("No file provided"));
    }
    
    // Image size limit: 10MB
    const fileSizeMB = file.size / (1024 * 1024);
    const MAX_IMAGE_SIZE_MB = 10;
    
    if (fileSizeMB > MAX_IMAGE_SIZE_MB) {
        return Promise.reject(
            new Error(`Image too large! Maximum size is ${MAX_IMAGE_SIZE_MB}MB. Your image: ${fileSizeMB.toFixed(1)}MB`)
        );
    }
    
    return uploadWithXHR(file, "image", "profiles", onProgress);
};

/**
 * 🎵 Audio upload (for voice messages)
 * Used in Room.jsx for voice recordings
 */
export const uploadAudioToCloudinary = (file, onProgress) => {
    if (!file) {
        return Promise.reject(new Error("No file provided"));
    }
    
    // Audio size limit: 50MB
    const fileSizeMB = file.size / (1024 * 1024);
    const MAX_AUDIO_SIZE_MB = 50;
    
    if (fileSizeMB > MAX_AUDIO_SIZE_MB) {
        return Promise.reject(
            new Error(`Audio too large! Maximum size is ${MAX_AUDIO_SIZE_MB}MB. Your audio: ${fileSizeMB.toFixed(1)}MB`)
        );
    }
    
    return uploadWithXHR(file, "video", "audio", onProgress); // Cloudinary uses "video" for audio files
};
