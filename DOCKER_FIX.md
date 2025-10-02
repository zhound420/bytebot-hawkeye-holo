# Docker Fix - Run After Docker Desktop Restarts

Once Docker Desktop is healthy (can run `docker ps` without errors), run these commands:

```bash
# 1. Clean Docker build cache
docker builder prune -f

# 2. Remove dangling images
docker image prune -f

# 3. Check free space
docker system df

# 4. Rebuild stack
cd /Users/zohairf/Documents/repos/bytebot-hawkeye-cv
./scripts/stop-stack.sh
./scripts/start-stack.sh
```

## If builds still fail:

```bash
# Nuclear option: Remove all Docker data and start fresh
docker system prune -a --volumes -f

# Then rebuild
./scripts/start-stack.sh
```

## To prevent this in the future:

**Keep at least 50GB free disk space** - Docker needs breathing room. Consider:
- Removing old projects/repos
- Emptying Downloads folder
- Using external storage for large files
- Regular `docker system prune` cleanups
