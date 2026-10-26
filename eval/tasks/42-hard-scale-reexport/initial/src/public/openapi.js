/**
 * OpenAPI 描述（手写的一小段，够前端联调就行）。
 */

/** 生成一份最小的 spec */
function openApiSpec(title) {
  return {
    openapi: '3.0.0',
    info: { title: title || 'Internal API', version: '2.4.0' },
    paths: {},
  };
}

module.exports = { openApiSpec };
