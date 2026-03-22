FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY judgeme_review_report.py .

CMD ["python", "judgeme_review_report.py"]
