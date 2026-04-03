// Compatibility re-export
// Some pages/components import `../cloudinary`. The enhanced implementation now
// lives in `cloudinary_enhanced.js`, so we re-export the same named exports.
export {
    uploadToCloudinary,
    uploadImageToCloudinary,
    uploadAudioToCloudinary,
} from "./cloudinary_enhanced";

