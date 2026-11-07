# 马里奥音频素材

以下 WAV 保留上游原始字节，可供游戏音效接入时使用。

| 文件 | 上游路径 | 大小 | 时长 | 格式 |
| --- | --- | --- | --- | --- |
| 原版笑声.wav | yugh6/Naiwa 的原版笑声.wav | 622,482 字节 | 14.113 秒 | PCM 16-bit，单声道，22,050 Hz |
| niulai.wav | isheng-eqi/dsh-niulai-sound 的 assets/niulai.wav | 159,914 字节 | 1.812 秒 | PCM 16-bit，单声道，44,100 Hz |

原版笑声的来源仓库使用 PolyForm Noncommercial License 1.0.0，限定非商业用途。来源与许可条款见下方链接。

- https://github.com/yugh6/Naiwa/blob/HEAD/原版笑声.wav
- https://polyformproject.org/licenses/noncommercial/1.0.0/

niulai.wav 的来源仓库使用 MIT License，完整声明保存在同目录的 LICENSE.niulai.txt。上游 README 将音频标注为动画电影《牛来》原声片段。来源见下方链接。

- https://github.com/isheng-eqi/dsh-niulai-sound/blob/HEAD/assets/niulai.wav
- https://github.com/isheng-eqi/dsh-niulai-sound

两份文件均通过 Git blob SHA-1 与上游内容比对，并使用 Python wave 检查 WAV 参数和帧数。音频合计 782,396 字节，约 764 KiB。
