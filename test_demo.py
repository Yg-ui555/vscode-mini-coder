# 简单的测试文件（用于触发 Mini-Coder 特色 1 的自动跑测试）
# 改名含 test 是关键，file watcher 会监听这种文件名

def add(a, b):
    # 今天我加了个测试（这是新加的注释）
    return a + b


def subtract(a, b):
    return a - b


# 测试函数（pytest 找 test_ 开头的函数）
def test_add():
    assert add(2, 3) == 5
    assert add(-1, 1) == 0
    assert add(0, 0) == 0


def test_subtract():
    assert subtract(10, 3) == 7
    assert subtract(0, 5) == -5


if __name__ == '__main__':
    test_add()
    test_subtract()
    print("All tests passed!")