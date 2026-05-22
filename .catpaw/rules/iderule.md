---
ruleType: Optional types are Always, Auto Attached, Manual, and Model Request
description: Description of the rules
globs: Only needed in Auto Attached mode, specify the file extensions to match, such as *.vue,*.ts
---
# git 提交规则

1.提交代码除用户明确可以自动提交外，其它情况不允许自动提交代码,必须由用户决策\
2.用户提交命名只适用于单次自动执行，不允许在后续代码中出现代码自动提交\
3.提交代码必须有明确的提交描述

# 编码规范

1.代码逻辑需要严格参考“.work”中的相关文档，不允许偏离设计文档\
2.如果在编码出现实现逻辑及设计文档冲突或是偏离设计文档，需要与用户进行澄清，用户确认后需要同步更新对应的设计文档，在继续执行相关逻辑\
3.用户提出的所有需求问题都必须记录到“.work”下的“执行文档.md”中，作为记忆内容，后续编码过程中需要同步关联之前的编码要求
4.一切修改基于现有的代码编码，不要试图恢复代码
