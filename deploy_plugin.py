import argparse
import zipfile
import shutil
import sys
import tempfile
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(
        description="Скрипт для автоматической раскатки плагина Obsidian по всем локальным хранилищам.",
        formatter_class=argparse.RawTextHelpFormatter,
        epilog="""Пример использования:
  python deploy_plugin.py timeline-card.zip
  python deploy_plugin.py my-plugin.zip -v ~/MyVaults"""
    )
    parser.add_argument("zip_file", help="Путь к ZIP-архиву с плагином (например, timeline-card.zip)")
    parser.add_argument("-v", "--vaults", default="~/Documents/Obsidian", 
                        help="Путь к корневой папке с хранилищами Obsidian\n(по умолчанию: ~/Documents/Obsidian)")
    
    args = parser.parse_args()
    
    zip_path = Path(args.zip_file).resolve()
    vaults_path = Path(args.vaults).expanduser().resolve()
    
    if not zip_path.is_file():
        print(f"Ошибка: Файл '{zip_path}' не найден.")
        sys.exit(1)
        
    if not vaults_path.is_dir():
        print(f"Ошибка: Директория с хранилищами '{vaults_path}' не найдена.")
        sys.exit(1)
        
    plugin_name = zip_path.stem
    print(f"Имя плагина: {plugin_name}")
    print(f"Поиск хранилищ в: {vaults_path}\n")
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        print("Распаковка архива во временную папку...")
        try:
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(temp_path)
        except zipfile.BadZipFile:
            print("Ошибка: Указанный файл не является корректным ZIP-архивом.")
            sys.exit(1)
            
        # Ищем реальный корень плагина по файлу manifest.json, игнорируя системный мусор macOS
        manifest_files = [f for f in temp_path.rglob("manifest.json") if "__MACOSX" not in f.parts]
        
        if not manifest_files:
            print("Ошибка: В архиве не найден файл manifest.json. Проверьте содержимое ZIP.")
            sys.exit(1)
            
        source_plugin_dir = manifest_files[0].parent
        print(f"Корень плагина определен в распакованных файлах.")
            
        vaults_found = 0
        updated_vaults = 0
        
        for vault_dir in vaults_path.iterdir():
            if not vault_dir.is_dir():
                continue
                
            obsidian_dir = vault_dir / ".obsidian"
            if not obsidian_dir.is_dir():
                continue
                
            vaults_found += 1
            plugins_dir = obsidian_dir / "plugins"
            plugins_dir.mkdir(parents=True, exist_ok=True)
            
            target_plugin_dir = plugins_dir / plugin_name
            
            print(f"Хранилище: {vault_dir.name} -> Обновление плагина...")
            
            # Удаляем старую версию, чтобы не оставалось лишних файлов
            if target_plugin_dir.exists():
                shutil.rmtree(target_plugin_dir)
                
            # Копируем только нужную директорию (без __MACOSX и без лишней вложенности)
            shutil.copytree(source_plugin_dir, target_plugin_dir)
            updated_vaults += 1
            
        print(f"\nГотово! Найдено хранилищ: {vaults_found}. Плагин успешно обновлен в: {updated_vaults}.")

if __name__ == '__main__':
    main()