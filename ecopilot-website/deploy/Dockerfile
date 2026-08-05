FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制服务代码
COPY deploy/*.py /app/

# 数据目录
RUN mkdir -p /app/data

EXPOSE 8090 8091 8092 8093

CMD ["python3", "website_api.py"]
