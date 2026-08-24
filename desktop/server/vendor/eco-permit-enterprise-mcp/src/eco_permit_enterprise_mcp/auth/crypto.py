"""RSA 登录凭证加密（复现登录页 David Shapiro RSA JS 库的 encryptedString）。

登录页（/cas/login）内联 JS 的加密逻辑：
    var key = RSAUtils.getKeyPair(exponent, '', modulus);
    $("#hideusername").val(RSAUtils.encryptedString(key, username + SALT));
    $("#hidepassword").val(RSAUtils.encryptedString(key, password + SALT));

其中 RSAUtils.encryptedString 是**确定性 raw RSA（无 padding）**：
1. 明文转字节序列，补 ``\\x00`` 到 chunkSize 的整数倍。
2. 每个 chunk 按**小端序**（低字节在低位）解释为大整数 m。
3. ``c = m^e mod n``（RSA raw）。
4. ``c`` 转大端 hex（补前导零到 modulus 字节数 * 2）。

chunkSize = 2 * (modulus 的最高非零 16-bit digit 索引)，等价于
``2 * (ceil(n.bit_length() / 16) - 1)``。

注意：modulus/exponent 每次加载登录页都会变化（服务器按 session 动态生成
RSA 密钥对），必须在登录时从当前登录页的 ``hid_modulus``/``hid_exponent``
隐藏字段提取，不能缓存。
"""

from __future__ import annotations

# 登录页 JS 硬编码的加密盐（明文末尾拼接）。注意：该盐**每次加载登录页动态变化**
# （形如 "eCB1" / "X5L1" / "GqRB"），必须从当前登录页 HTML 动态提取，不能硬编码。
# 此常量仅作为默认兜底，正常情况下由 AuthManager 从登录页解析后传入。
SALT = "X5L1"


def rsa_encrypt(
    plaintext: str,
    modulus_hex: str,
    exponent_hex: str = "010001",
    salt: str = "",
) -> str:
    """按登录页 JS 算法对明文做 RSA 加密，返回小写 hex 密文。

    Args:
        plaintext: 明文（内部会拼接 ``salt``）。
        modulus_hex: RSA modulus（hex 字符串，来自 hid_modulus）。
        exponent_hex: RSA exponent（hex 字符串，来自 hid_exponent）。
        salt: 动态盐（从登录页 JS ``encryptedString(key, val + "盐")`` 提取），
            未传时回退到 :data:`SALT`。

    Returns:
        密文 hex 字符串（无空格分隔，单 block）。
    """
    n = int(modulus_hex, 16)
    e = int(exponent_hex, 16)

    # chunkSize = 2 * (ceil(bit_length/16) - 1)
    digits = (n.bit_length() + 15) // 16
    chunk_size = 2 * (digits - 1)
    if chunk_size <= 0:
        chunk_size = 2 * digits

    payload = plaintext + (salt or SALT)
    a = list(payload.encode("utf-8"))
    while len(a) % chunk_size != 0:
        a.append(0)

    hex_len = 2 * ((n.bit_length() + 7) // 8)

    parts: list[str] = []
    for i in range(0, len(a), chunk_size):
        chunk = a[i : i + chunk_size]
        m = 0
        for j, byte in enumerate(chunk):  # 小端序
            m += byte * (256**j)
        c = pow(m, e, n)
        parts.append(format(c, "x").zfill(hex_len))
    return "".join(parts)


__all__ = ["rsa_encrypt", "SALT"]
