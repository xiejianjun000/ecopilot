"""纯 HTTP 数据访问层：requests 封装 + GBK 解码 + HTML 解析。"""

from .http_client import HttpClient, HttpResponse
from .parser import HtmlParser

__all__ = ["HttpClient", "HttpResponse", "HtmlParser"]
