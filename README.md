# Product service

Каталог товаров, вариантов, брендов, свойств, единиц измерения и типов товаров.
Исходники: `code/service`, общая outbox-библиотека: `code/library/sellgar.outbox.library`.
Старая реализация сохранена в `code/_service` и не входит в сборку.

## Обычное чтение и интеграционные снимки

`catalog.v2.product.getAll`, `getByUuid`, `variant.getAll` и `variant.getByUuid`
исключают архивные Product/Variant в запросах к БД. Вложенные варианты и поиск
по их свойствам следуют тому же правилу. Обычное чтение архивного UUID даёт NotFound;
передача status=archived не снимает ограничение. Страницы формируются после SQL-отбора.

`catalog.v2.product.getSnapshot { uuid }` — отдельная внутренняя RMQ-команда полного
снимка для recovery Store/Cart. Она сохраняет архивный корень, варианты и их состояния,
как и outbox. Редактирование архива и восстановление сохраняют прежнее поведение.

## Архивирование и связанные продажи

`catalog.v2.product.archiveImpact { uuid, variantUuid? }` возвращает число связанных
предложений и магазинов из Store. Admin всегда запрашивает подтверждение архивирования,
в том числе при отсутствии связей.

После изменения собственного статуса Product передает полный снимок командой
`store.catalog.synchronizeSnapshot` и ожидает подтверждения Store. При архивировании
Product Store архивирует все его размещения и предложения; при архивировании Variant —
только соответствующие предложения. Учётки, цены и остатки сохраняются.
Cart сохраняет строку с сообщением о недоступности и исключает её из суммы и оформления.

Если Store не подтвердил применение, команда завершается ошибкой. Повтор архивирования
уже архивированной сущности повторяет доставку снимка без изменения версии и нового
события Product. Обычный outbox также доставляет факт архивирования.

Для этого изменения сначала обновить Store, затем Product и Cart, затем gateway/UI.
Product требует `AMQP_STORE_SRV_COMMAND_QUEUE=store_srv.command.queue`.
Миграции БД не требуются. Восстановление связанных продаж этим изменением не вводится.

## Проверка

Из `code/`: `yarn build:product_srv` и `yarn workspace @service/product test --runInBand`.
Тесты проекций изображений используют временный PostgreSQL 16+ (`PG_BIN` или
`pg_config`); тесты FTS запускаются отдельно с `PRODUCT_SEARCH_DATABASE_TESTS=1`.
CI запускает юнит-тесты отдельной job `unit` до сборки приложения.
Docker target `tests` использует слой зависимостей; PostgreSQL и сборка Nest не требуются.
Наборы `*.integration.spec.ts` остаются для отдельного запуска и в unit job не входят.
Сами тесты остаются в `code/service/src`; сборка образов их не запускает.

Из корня:

```bash
docker build --target application -t sellgar-product:application .
docker build --target migration -t sellgar-product:migration .
docker build --target tests --progress plain .
```

Юнит-тестам не нужны dev/prod базы.

## CI и доставка

`ci.yml` запускается только на push в development. В его графе только пять
выполняемых jobs: unit, build, publish, migrate, deploy.
`checks.yml` обслуживает PR и push в release/*; в dev-запуск он не входит.
Общая сборка и публикация определены один раз в reusable `build-service.yml`
репозитория infrastructure. Юнит-тесты — в `test-application.yml`, миграция доставки — в `deliver-service.yml`.

`development`: unit → build → publish → delivery/migrate → delivery/deploy.
`release/*`: unit → build → publish; кандидат допускается к prod только после
успешного CI целиком. PR выполняет unit → build, без публикации и миграций.
После merge release в master кнопка `Release to production` принимает тег кандидата,
проверяет его исходники и образы и вызывает тот же delivery workflow для prod:
migrate, затем deploy. Повторной сборки и тестов опубликованного кандидата нет.
Обратный PR master → development создаётся только после успешной доставки.
Проверка ветки master требует обычного merge commit, а не squash/rebase.

Два Docker target остаются: `application` запускает Nest без migrations/CLI
DataSource, `migration` выполняет TypeORM CLI и завершает процесс. Build передаёт
образы publish через artifact; публикация ждёт build и проверяет image IDs.
Уникальные image tags включают source SHA, run ID и attempt. Runtime использует
только digest. Release asset `release.json` сохраняет source/chart revisions,
оба digest и CI run. Для кандидатов включается GitHub immutable releases.

Helm values принадлежат сервису: `helm/values.app.yaml` и `helm/dev|prod/values.yaml`.
Общие templates и reusable build/delivery workflows принадлежат infrastructure.
Chart checkout при build закрепляется SHA в кандидате, values берутся из source SHA.
Workflow и checkout chart закреплены версией `delivery-v0.7.0` infrastructure;
сначала публикуется этот immutable release/tag, затем Product. Тег не перемещается.
Собственных Python-скриптов в CI и доставке Product нет. Отдельная RMQ/Docker
smoke-цепочка удалена; под другим именем она не переносится.

`.env` приложения монтируется из immutable ConfigMap конкретного выпуска;
предыдущие версии сохраняются для ещё работающих pod. У migration Job собственный
ConfigMap. Credentials поступают через Secret refs, а не через GitHub build jobs.
Secret names: `product-database`, `rabbitmq-default-user`, registry `ghcr-pull`.
Database/user: `product_srv`. В prod эти ресурсы создаются отдельно в sellgar-prod;
наличие prod values не означает, что production уже развёрнут.

Миграция получает только DB secret refs, backoffLimit 0 и deadline 600 секунд.
Ошибка unit блокирует build, publish, migrate и deploy. Ошибка migration Job блокирует deploy.
Cancel workflow не удаляет выполняющуюся миграцию;
следующий запуск отказывается стартовать поверх активной Job. Незавершённая Helm
operation также требует проверки оператором до retry. Никакого автоматического
реверса миграций нет. Миграции при Nest startup отключены.

Первое включение требует self-hosted runner `sellgar-dev` и передачи Product из
Argo в Helm без удаления ресурсов. Все действия и ограничения описаны в
infrastructure `docs/product-delivery.md` и `bootstrap/runner/README.md`.
Все dev-приложения используют общий organization runner и Helm CI; Argo управляет платформой.

В dev 21 ноября 2026 установлен официальный repository runner
`sellgar-product-dev`: отдельный пользователь `product-runner`, systemd-служба,
доступ Kubernetes только к `sellgar-dev`. Product передан от Argo CD к Helm с
сохранением работающего сервиса и данных. Runner запускается вместе с VM;
порядок обслуживания и обновления его сертификата находится в руководстве
infrastructure `bootstrap/runner/README.md`.

Внутренние Service/container: 8080. `GET /health` проверяет БД и оба RMQ consumer.
Readiness HTTP не управляет доставкой RabbitMQ-команд; отсутствие потерь при
rollout не обещается без отдельной проверки транспорта. Бизнес-контракты:
`code/service/README.md`, `REWRITE-CONTRACT.md`.

## Курсорные списки

Самостоятельные списки принимают `{ limit?: number, nextToken?: string, ...filters }`
и возвращают `{ items, meta: { limit, nextToken: string | null } }`.
Размер пачки по умолчанию 50, максимум 100. OFFSET и общее количество удалены;
при продолжении нужно передавать прежние фильтры. Новый фильтр/сортировка — новый
список без токена. Корни выбираются до relations; коллекции карточек и снимков
остаются полными. Последний ключ сортировки — уникальный PK.

Пакет `@sellgar/pagination` подключён через nested submodule; build и unit image
сначала собирают его. `PaginationModule` требует `PAGINATION_TOKEN_SECRET` минимум
32 байта, одинаковый у реплик сервиса. Helm читает его из Secret `product-pagination`,
ключ `token-secret`. Ansible infrastructure создаёт отсутствующие ключи командой
`.venv/bin/ansible-playbook -i inventory/dev.yml secrets.yml --tags pagination` из ansible/
без замены существующих значений. Локально ключ задаётся окружением; в Git его нет.
Отсутствие/слабый ключ блокирует настройку пагинации. HMAC не предоставляет доступ:
ограничения магазина/владельца применяются заново к каждому запросу.
