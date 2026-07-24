.PHONY: dev start stop restart test deploy clean

dev:
	./start.sh

start:
	docker-compose up -d

stop:
	docker-compose down

restart:
	docker-compose restart

test:
	cd /Users/mac/Desktop/ecopilot/ecopilot-website/deploy && python3 /Users/mac/.trae-cn/work/6a44cda4bd529bc6633f8509/test_all.py

deploy:
	./deploy.sh

clean:
	pkill -f "auth_service\|subscription_service\|website_api\|payment_service\|http.server" 2>/dev/null
	rm -rf data/*.json data/.jwt_secret

logs-auth:
	tail -f /tmp/auth.log

logs-sub:
	tail -f /tmp/sub.log

logs-web:
	tail -f /tmp/web.log

logs-payment:
	tail -f /tmp/payment.log
