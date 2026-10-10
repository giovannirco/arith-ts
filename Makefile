# Variables you may want to override on the command line:
#   make image TAG=dev
#   make deploy TAG=dev NAMESPACE=arith
#
# VERSION is the release, read from package.json; Chart.yaml and the Kustomize
# base carry the same one. TAG defaults to it, so `make deploy` installs the
# release. A local build gets a tag no release uses, such as dev.
RELEASE_IMAGE := ghcr.io/giovannirco/arith-ts
VERSION   := $(shell sed -n 's/^  "version": "\(.*\)",$$/\1/p' package.json)
IMAGE     ?= $(RELEASE_IMAGE)
TAG       ?= $(VERSION)
NAMESPACE ?= arith
RELEASE   ?= arith
CHART     ?= deploy/helm/arith-ts

.PHONY: help version test cover lint run image push deploy upgrade remove kustomize-deploy kustomize-remove

help: ## This list
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

version: ## The release version, from package.json
	@echo $(VERSION)

test: ## Unit and HTTP tests
	npm test

cover: ## Tests with a line and branch coverage report (c8)
	npm run cover
	@echo "HTML report: coverage/index.html"

lint: ## ESLint and the type check, as CI runs them
	npm run lint

run: ## Serve on :8000 with readable logs
	ARITH_LOG_FORMAT=text node src/main.ts

image: ## Build $(IMAGE):$(TAG) for this machine's architecture
	docker build -t $(IMAGE):$(TAG) .

push: ## Push $(IMAGE):$(TAG) to your own registry (set IMAGE)
	@if [ "$(IMAGE)" = "$(RELEASE_IMAGE)" ]; then \
	  echo "$(RELEASE_IMAGE) is published by CI from a v<version> tag; set IMAGE to your own registry."; exit 1; fi
	docker push $(IMAGE):$(TAG)

deploy: ## Install or upgrade the Helm release with image tag $(TAG)
	helm upgrade --install $(RELEASE) $(CHART) \
	  --namespace $(NAMESPACE) --create-namespace \
	  --set image.tag=$(TAG) --wait

upgrade: deploy ## Same as deploy; reads better after a change

remove: ## Uninstall the release and delete the namespace
	helm uninstall $(RELEASE) --namespace $(NAMESPACE) --ignore-not-found
	kubectl delete namespace $(NAMESPACE) --ignore-not-found

kustomize-deploy: ## The same deployment through kubectl apply -k
	kubectl apply -k deploy/kustomize/base
	kubectl -n $(NAMESPACE) rollout status deployment/arith

kustomize-remove: ## Delete what kustomize-deploy created, namespace included
	kubectl delete -k deploy/kustomize/base --ignore-not-found
