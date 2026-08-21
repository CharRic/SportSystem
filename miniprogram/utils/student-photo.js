async function chooseStudentPhoto() {
  const result = await wx.chooseMedia({ count: 1, mediaType: ["image"], sourceType: ["album", "camera"], sizeType: ["compressed"] });
  const file = result.tempFiles && result.tempFiles[0];
  if (!file || !file.tempFilePath) throw new Error("未选择照片");
  const localPath = file.tempFilePath;
  const extension = (localPath.match(/\.[a-zA-Z0-9]+$/) || [".jpg"])[0].toLowerCase();
  const cloudPath = `student-photos/internal/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.floor(Math.random() * 100000)}${extension}`;
  const uploaded = await wx.cloud.uploadFile({ cloudPath, filePath: localPath });
  return uploaded.fileID;
}

module.exports = { chooseStudentPhoto };
