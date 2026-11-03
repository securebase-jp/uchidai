/**
 * 記事を読めないサーバ（Claude API のキーが無い）だと分かったら、このブラウザに覚えておく。
 * 次からは「記録済みの事例」のタブを先に出し、「記事を貼る」に注記を添える
 */
const READ_UNAVAILABLE_KEY = "uchidai.home.readUnavailable.v1";

export const readUnavailable = {
  load: (): boolean => {
    try {
      return localStorage.getItem(READ_UNAVAILABLE_KEY) === "1";
    } catch {
      return false;
    }
  },
  save: () => {
    try {
      localStorage.setItem(READ_UNAVAILABLE_KEY, "1");
    } catch {
      /* 保存できなくても動作には影響しない */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(READ_UNAVAILABLE_KEY);
    } catch {
      /* 同上 */
    }
  },
};
