import sys
import os

# Add the project root to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.cache_service import cache

def test_cache():
    print("--- Testing CacheService Fallback ---")
    
    # 1. Test SET
    print("Setting key 'test_key' with value 'hello_world'...")
    success = cache.set('test_key', 'hello_world', ttl=10)
    print(f"Set success: {success}")
    
    # 2. Test GET
    print("Getting value for 'test_key'...")
    val = cache.get('test_key')
    print(f"Retrieved value: {val}")
    
    if val == 'hello_world':
        print("✅ SUCCESS: Value retrieved correctly.")
    else:
        print("❌ FAILURE: Value mismatch.")
        
    # 3. Test DELETE
    print("Deleting 'test_key'...")
    deleted = cache.delete('test_key')
    print(f"Deleted: {deleted}")
    
    val_after = cache.get('test_key')
    print(f"Value after delete: {val_after}")
    
    if val_after is None:
        print("✅ SUCCESS: Delete worked.")
    else:
        print("❌ FAILURE: Value still exists after delete.")

    # 4. Test Invalidate (Pattern)
    print("Testing Invalidation...")
    cache.set('ws:1', 'ws1_data')
    cache.set('ws:2', 'ws2_data')
    cache.set('doc:1', 'doc1_data')
    
    print("Invalidating 'ws:*'...")
    cache.invalidate('ws:*')
    
    print(f"ws:1 -> {cache.get('ws:1')}")
    print(f"ws:2 -> {cache.get('ws:2')}")
    print(f"doc:1 -> {cache.get('doc:1')}")
    
    if cache.get('ws:1') is None and cache.get('doc:1') == 'doc1_data':
        print("✅ SUCCESS: Pattern invalidation worked.")
    else:
        print("❌ FAILURE: Pattern invalidation failed.")

if __name__ == "__main__":
    test_cache()
