# Phase 0: 小红书 API 抓包验证指南

## 目的

验证小红书搜索列表 API 是否在返回数据中包含「24小时加购」信息。
如果包含，后续爬虫可以大幅提升效率（不用逐个点进详情页）。

---

## 环境准备

### 爬虫 Mac 上安装 mitmproxy

```bash
# 安装 Python 3.10+（如果没有）
brew install python

# 安装 mitmproxy
pip3 install mitmproxy

# 验证安装
mitmproxy --version
```

### 获取 Mac 局域网 IP

```bash
# 在终端执行
ifconfig | grep "inet " | grep -v 127.0.0.1
# 记下类似 192.168.x.x 的地址
```

---

## Step 1: 启动 mitmproxy

在爬虫 Mac 上打开终端：

```bash
# 方式A: 使用 Web 界面（推荐，更直观）
mitmweb --listen-port 8080

# 方式B: 使用命令行（需要更多经验）
mitmproxy --listen-port 8080
```

启动后，mitmproxy 会在 `~/.mitmproxy/` 目录生成 CA 证书。

---

## Step 2: 手机配置代理

### 2.1 连接同一 WiFi

确保 Pixel 5 和爬虫 Mac 在同一个 WiFi 网络下。

### 2.2 设置 WiFi 代理

1. 手机打开 **设置 → 网络和互联网 → WLAN**
2. 长按当前连接的 WiFi → **修改网络**
3. 展开 **高级选项**
4. **代理** 选择「手动」
5. **代理主机名**: 填写 Mac 的局域网 IP（如 `192.168.1.100`）
6. **代理端口**: `8080`
7. 保存

### 2.3 验证代理

在手机浏览器访问 `http://mitm.it`，如果看到 mitmproxy 的证书下载页面，说明代理配置成功。

---

## Step 3: 安装系统级 CA 证书 (Magisk)

小红书 App 只信任系统级证书，普通用户证书不行。需要用 Magisk 将 mitmproxy 的 CA 证书安装为系统证书。

### 方法A: 使用 MagiskTrustUserCerts 模块（最简单）

1. 手机浏览器访问 `http://mitm.it`
2. 点击 **Android** 下载 `mitmproxy-ca-cert.cer`
3. 设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书 → 选择下载的 .cer 文件
4. 打开 Magisk App → 模块 → 从存储安装
5. 搜索或手动下载 `MagiskTrustUserCerts` 模块的 zip
   - GitHub: https://github.com/NVISOsecurity/MagiskTrustUserCerts
   - 下载 Release 里的 zip 文件
6. 在 Magisk 中安装该模块
7. **重启手机**

重启后，用户证书会自动被提升为系统证书。

### 方法B: 手动复制到系统证书目录

```bash
# 在 Mac 终端通过 adb 操作
# 先将证书推送到手机
adb push ~/.mitmproxy/mitmproxy-ca-cert.cer /sdcard/

# 进入 adb shell
adb shell

# 获取 root 权限
su

# 将证书转换并复制到系统证书目录
# 先计算证书 hash
openssl x509 -inform PEM -subject_hash_old -in /sdcard/mitmproxy-ca-cert.cer | head -1
# 假设输出 c8750f0d

# 复制并重命名
cp /sdcard/mitmproxy-ca-cert.cer /system/etc/security/cacerts/c8750f0d.0
chmod 644 /system/etc/security/cacerts/c8750f0d.0

# 重启
reboot
```

---

## Step 4: 绕过 SSL Pinning (如需要)

如果安装系统证书后仍然抓不到小红书的 HTTPS 流量，说明 App 做了 SSL Pinning，需要额外绕过。

### 方法: LSPosed + JustTrustMe

1. **安装 LSPosed**:
   - 确保 Magisk 已启用 Zygisk（Magisk → 设置 → 开启 Zygisk）
   - 下载 LSPosed (Zygisk) 模块: https://github.com/LSPosed/LSPosed/releases
   - 在 Magisk 模块中安装，重启

2. **安装 JustTrustMe**:
   - 下载: https://github.com/Fuzion24/JustTrustMe/releases
   - 安装 APK
   - 打开 LSPosed → 模块 → 启用 JustTrustMe → 勾选「小红书」
   - 重启手机

---

## Step 5: 抓取小红书数据

### 5.1 开始抓包

1. 确认 mitmweb 正在运行（Mac 终端）
2. 在浏览器打开 `http://127.0.0.1:8081`（mitmweb 的 Web 界面）
3. 打开手机上的小红书 App

### 5.2 操作流程

在小红书 App 中执行以下操作（同时观察 mitmweb 界面的流量）：

1. **点击底部「市集」tab**
2. **点击搜索框，输入一个关键词**（如「袜子」）
3. **切换到「商品」tab**
4. **浏览搜索结果列表** — 注意观察 mitmweb 中出现的请求
5. **向下滚动几屏** — 触发更多数据加载
6. **点进一个商品详情页** — 对比详情页的请求数据

### 5.3 筛选关键请求

在 mitmweb 的过滤栏中输入：
```
~d xiaohongshu.com & ~m GET
```

或者在命令行模式中：
```bash
mitmdump --listen-port 8080 -w capture.flow "~d xiaohongshu.com"
```

### 5.4 重点查找

找到类似以下特征的请求：
- URL 包含 `search` 或 `goods` 或 `product`
- 请求方法: GET 或 POST
- 响应是 JSON 格式

在响应 JSON 中搜索以下关键字：
- `add_cart` / `addCart` / `加购`
- `24h` / `24_hour` / `recent`
- `hot_tag` / `hot_label` / `tag`
- `purchase` / `buyer`
- `collect` / `收藏`

---

## Step 6: 记录结果

请把以下信息记录/截图给我：

### 搜索列表 API
- [ ] 完整的请求 URL
- [ ] 请求 Headers（特别是 Authorization, X-Sign, shield 等签名相关的）
- [ ] 响应 JSON 的完整结构（重点关注单个商品的字段列表）
- [ ] **是否包含 24h 加购相关字段？** ← 这是核心问题

### 商品详情 API
- [ ] 完整的请求 URL
- [ ] 响应 JSON 中 24h 加购标签的字段名和格式
- [ ] 店铺信息的字段结构

### 其他发现
- [ ] 请求中是否有签名/加密参数？
- [ ] 分页机制是什么样的？（cursor / page / offset）
- [ ] 是否有频率限制的提示？

---

## 抓包完成后

把抓到的数据反馈给我，我会根据结果决定：

1. **如果列表 API 包含 24h 加购** → 优先使用 API 方案，大幅提升效率
2. **如果不包含** → 使用 UI 自动化方案（已在计划中）
3. **如果有复杂的请求签名** → 评估签名破解难度，决定混合方案

---

## 常见问题

**Q: mitmweb 里看不到小红书的流量？**
A: 可能 SSL Pinning 没绕过，按 Step 4 操作。也检查一下手机代理是否配置正确。

**Q: 小红书 App 打开后报网络错误？**
A: 先确认证书安装正确。尝试在手机浏览器访问 https://www.baidu.com，如果正常说明代理没问题，问题在 SSL Pinning。

**Q: 抓到的数据是加密的乱码？**
A: 小红书可能对部分 API 响应做了加密。记录加密特征反馈给我，我们评估是否可以解密。

**Q: 我不想在手机上装太多模块，有更简单的方式吗？**
A: 最简单的方式是 Charles Proxy（Mac 上的 GUI 抓包工具），配合 Magisk 证书模块。操作界面更友好。
```bash
brew install --cask charles
```
