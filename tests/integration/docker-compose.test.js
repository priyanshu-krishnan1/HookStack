const fs = require('fs');
const path = require('path');

describe('docker-compose infrastructure', () => {
  test('contains postgres and rabbitmq services', () => {
    const compose = fs.readFileSync(path.join(__dirname, '../../docker-compose.yml'), 'utf8');

    expect(compose).toContain('postgres:');
    expect(compose).toContain('rabbitmq:');
    expect(compose).toContain('postgres:16');
    expect(compose).toContain('rabbitmq:3.13-management');
  });

  test('mounts schema initialization for postgres', () => {
    const compose = fs.readFileSync(path.join(__dirname, '../../docker-compose.yml'), 'utf8');

    expect(compose).toContain('./shared/schema.sql:/docker-entrypoint-initdb.d/001-schema.sql');
  });
});

// Made with Bob
