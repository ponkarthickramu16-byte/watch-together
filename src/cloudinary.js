const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

// Helper function — internal use only
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

// 🎬 Movie / Video upload — Room.jsx-ல் use பண்ணு
export const uploadToCloudinary = (file, onProgress) => {
    return uploadWithXHR(file, "video", "movies", onProgress);
};

// 📸 Profile Photo / Image upload — ProfileSetup.jsx-ல் use பண்ணு
export const uploadImageToCloudinary = (file, onProgress) => {
    return uploadWithXHR(file, "image", "profiles", onProgress);
};