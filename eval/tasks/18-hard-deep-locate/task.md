# 任务：个人资料页的用户名显示不对

## Bug 现象

用户报障：资料页上，**只填了空白昵称**的用户，头像旁显示的是一片空白，而不是他们的用户名。

具体来说，仓库里有这两个用户：

```js
{ name: '   ', handle: 'nobody' }   // 昵称全是空格
{ handle: 'ghost' }                // 昵称字段干脆没填
```

他们现在在页面上显示成 ` (nobody)` 和 ` (ghost)`——昵称位置是空的，用户名完全没露出来。

正常用户 `{ name: '张三', handle: 'zhangsan' }` 显示成 `张三 (zhangsan)`，这是对的，别改坏。

## 你要做的

把昵称回退逻辑修好：**昵称缺失、类型不对、或者去掉首尾空格后是空的**，都应该回退到 `handle`；连 `handle` 都没有时才回退到 `'anonymous'`。

## ⚠️ 仓库里有三个同名文件，别改错

| 文件 | 导出 | 契约 |
| --- | --- | --- |
| `src/services/account/profile/format.js` | `displayName(user)` | 入参是**用户**，有 `name` 和 `handle` |
| `src/services/audit/format.js` | `displayName(record)` | 入参是**审计记录**，只有 `actor` |
| `src/legacy/v1/render/format.js` | `formatName` / `formatRole` | 已冻结的 v1 报表渲染，跟本题无关 |

后两个文件的 `displayName` / `formatName` **本身是正确的**，但它们的入参契约跟第一个完全不同。把 audit 那份的实现抄过来会让 `displayName` 变成 `(record.actor) || 'system'`，对用户对象来说 `actor` 是 `undefined`，结果所有用户都显示成 `system`——比原来的 bug 更糟。

**只允许改 `src/services/account/profile/format.js` 这一个文件。**

## 硬约束

- `initials()` 的行为不能变：`张三` → `张`，`anonymous` → `?`。
- `profileLine()` 的格式不能变：`显示名 (handle)`。
- `src/app.js`、`src/routes/user.js`、`index.js` 都不需要改，也**不应该**改。
- 不要新增或删除文件。
- 审计日志页和 v1 报表页的输出必须逐字不变。

## 完成标准

`check.js` 会断言：空白/缺失昵称能正确回退到 `handle`、两个诱饵文件一个字节都没被碰、其余函数和另外两页的输出逐字不变、以及你确实用了目录遍历类的工具去找这份代码。

> 这道题在考什么：**在真实仓库里，"看起来对的地方"通常不止一处。**
> 三个同名文件、同一个函数名、只有入参契约不同——这不是刁难，这是代码库里天天发生的事。
> agent 最典型的失败模式是**改错文件还觉得自己改对了**：它会看到测试/输出有变化（因为它动了 audit 那份，行为确实变了），
> 于是收工报告"已修复"，而真正的 bug 纹丝不动。
> 这类失败只能靠"只改一个文件 + 断言另外两个没被碰"来抓住。