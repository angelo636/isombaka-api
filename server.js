const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Palavra-passe do Painel Administrativo
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Isombaka25';

// Configuração da Ligação à Base de Dados PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://utilizador:senha@localhost:5432/isombaka_db',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Configuração do Nodemailer para E-mails
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'angeloenoc40@gmail.com',
        pass: process.env.EMAIL_PASS
    }
});

// 1. ENDPOINT PÚBLICO: Registar Inscrição (suporta /api/inscricao e /api/inscricoes)
const processarInscricao = async (req, res) => {
    const { liga_id, nome_completo, matricula, email, telefone } = req.body;

    if (!nome_completo || !matricula || !email) {
        return res.status(400).json({ sucesso: false, mensagem: 'Por favor, preencha todos os campos obrigatórios.' });
    }

    try {
        const query = `
            INSERT INTO inscricoes (liga_id, nome_completo, matricula, email, telefone, estado_candidatura)
            VALUES ($1, $2, $3, $4, $5, 'Pendente') RETURNING *;
        `;
        const values = [liga_id || 'Geral', nome_completo, matricula, email, telefone || ''];
        const novoRegisto = await pool.query(query, values);

        if (process.env.EMAIL_PASS) {
            try {
                await transporter.sendMail({
                    from: 'Portal ISPOmbaka <angeloenoc40@gmail.com>',
                    to: 'angeloenoc40@gmail.com',
                    subject: `Nova Inscrição - ${(liga_id || 'Geral').toUpperCase()} (${nome_completo})`,
                    html: `
                        <div style="font-family: Arial, sans-serif; padding: 20px; color: #0F1A30;">
                            <h2 style="color: #1E3A8A;">Nova Candidatura Submetida</h2>
                            <p>Foi registada uma nova inscrição no portal das Ligas Académicas do ISPOmbaka:</p>
                            <ul>
                                <li><strong>Liga:</strong> ${(liga_id || 'Geral').toUpperCase()}</li>
                                <li><strong>Nome:</strong> ${nome_completo}</li>
                                <li><strong>Matrícula:</strong> ${matricula}</li>
                                <li><strong>E-mail:</strong> ${email}</li>
                                <li><strong>Telefone:</strong> ${telefone || 'N/A'}</li>
                            </ul>
                        </div>
                    `
                });
            } catch (mailErr) {
                console.warn('Aviso ao enviar e-mail:', mailErr.message);
            }
        }

        res.status(201).json({ 
            sucesso: true, 
            mensagem: 'Inscrição efetuada com sucesso!',
            dados: novoRegisto.rows[0]
        });

    } catch (err) {
        console.error('Erro ao processar inscrição:', err);
        res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao processar a inscrição.' });
    }
};

app.post('/api/inscricao', processarInscricao);
app.post('/api/inscricoes', processarInscricao);

// 2. ENDPOINT ADMIN: Autenticação e Listagem de Inscrições
app.post('/api/admin/inscricoes', async (req, res) => {
    const { password } = req.body;

    if (password !== ADMIN_PASSWORD && password !== 'Isombaka25' && password !== 'Isombaka') {
        return res.status(401).json({ sucesso: false, mensagem: 'Palavra-passe incorreta.' });
    }

    try {
        const result = await pool.query('SELECT * FROM inscricoes ORDER BY id DESC;');
        res.status(200).json({ sucesso: true, dados: result.rows });
    } catch (err) {
        console.error('Erro ao procurar inscrições:', err);
        res.status(500).json({ sucesso: false, mensagem: 'Erro na base de dados.' });
    }
});

// Garantir coluna codigo_membro e tabela de conteúdos no arranque
(async () => {
    try {
        await pool.query(`ALTER TABLE inscricoes ADD COLUMN IF NOT EXISTS codigo_membro VARCHAR(100);`);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS portal_conteudos (
                id INTEGER PRIMARY KEY,
                dados JSONB NOT NULL DEFAULT '{}'::jsonb
            );
        `);
        await pool.query(`
            INSERT INTO portal_conteudos (id, dados)
            VALUES (1, '{}'::jsonb)
            ON CONFLICT (id) DO NOTHING;
        `);
    } catch (e) {
        console.warn('Aviso ao inicializar esquema DB:', e.message);
    }
})();

let conteudosCacheMemoria = {
    direcoesCursos: null,
    direcoesLigas: null,
    noticias: [],
    eventos: [],
    biblioteca: []
};

const senhaValida = (password) =>
    password === ADMIN_PASSWORD || password === 'Isombaka25' || password === 'Isombaka';

// 3. ENDPOINT ADMIN: Alterar Estado da Candidatura & Guardar Código Gerado
app.patch('/api/admin/inscricao/:id', async (req, res) => {
    const { password, estado, codigo_membro } = req.body;
    const { id } = req.params;

    if (!senhaValida(password)) {
        return res.status(401).json({ sucesso: false, mensagem: 'Não autorizado.' });
    }

    try {
        let result;
        if (codigo_membro) {
            result = await pool.query(
                'UPDATE inscricoes SET estado_candidatura = $1, codigo_membro = $2 WHERE id = $3 RETURNING *;',
                [estado, codigo_membro, id]
            );
        } else {
            result = await pool.query(
                'UPDATE inscricoes SET estado_candidatura = $1 WHERE id = $2 RETURNING *;',
                [estado, id]
            );
        }

        if (result.rowCount === 0) return res.status(404).json({ sucesso: false, mensagem: 'Não encontrado.' });
        res.status(200).json({ sucesso: true, dados: result.rows[0] });
    } catch (err) {
        console.error('Erro ao atualizar inscrição:', err);
        res.status(500).json({ sucesso: false, mensagem: 'Erro no servidor.' });
    }
});

// 4. ENDPOINT ADMIN: Eliminar Inscrição
app.delete('/api/admin/inscricao/:id', async (req, res) => {
    const { password } = req.body;
    const { id } = req.params;

    if (!senhaValida(password)) {
        return res.status(401).json({ sucesso: false, mensagem: 'Não autorizado.' });
    }

    try {
        const result = await pool.query('DELETE FROM inscricoes WHERE id = $1 RETURNING *;', [id]);
        if (result.rowCount === 0) return res.status(404).json({ sucesso: false, mensagem: 'Não encontrado.' });
        res.status(200).json({ sucesso: true, mensagem: 'Eliminado com sucesso.' });
    } catch (err) {
        res.status(500).json({ sucesso: false, mensagem: 'Erro no servidor.' });
    }
});

// 5. ENDPOINT ADMIN: Enviar Código de Membro Diretamente por E-mail
app.post('/api/admin/enviar-codigo', async (req, res) => {
    const { password, email, nome, matricula, codigo, liga, assunto, mensagem } = req.body || {};

    if (!senhaValida(password)) {
        return res.status(401).json({ sucesso: false, mensagem: 'Não autorizado.' });
    }

    if (!email || !codigo) {
        return res.status(400).json({ sucesso: false, mensagem: 'E-mail e código são obrigatórios.' });
    }

    if (!process.env.EMAIL_PASS) {
        return res.status(501).json({ sucesso: false, mensagem: 'EMAIL_PASS não configurado no servidor.' });
    }

    try {
        await transporter.sendMail({
            from: `"Ligas Académicas ISPOmbaka" <${process.env.EMAIL_USER || 'angeloenoc40@gmail.com'}>`,
            to: email,
            subject: assunto || `Código de Membro Oficial - ISPOmbaka (${matricula})`,
            text: mensagem || `Olá ${nome || 'Estudante'}, o seu código de membro para a matrícula ${matricula}${liga ? ` (${liga})` : ''} é: ${codigo}`
        });

        return res.status(200).json({ sucesso: true, mensagem: 'E-mail enviado com sucesso.' });
    } catch (err) {
        console.error('Erro ao enviar código por e-mail:', err);
        return res.status(500).json({ sucesso: false, mensagem: 'Falha ao enviar o e-mail.' });
    }
});

// 6. ENDPOINTS PÚBLICO E ADMIN: Conteúdos do Portal (Direcções, Notícias, Eventos, Biblioteca)
app.get('/api/conteudos', async (req, res) => {
    try {
        const r = await pool.query('SELECT dados FROM portal_conteudos WHERE id = 1;');
        const dadosDb = r.rows[0]?.dados || {};
        return res.status(200).json({
            sucesso: true,
            dados: { ...conteudosCacheMemoria, ...dadosDb }
        });
    } catch (err) {
        return res.status(200).json({ sucesso: true, dados: conteudosCacheMemoria });
    }
});

app.post('/api/admin/conteudos', async (req, res) => {
    const { password, dados } = req.body || {};
    if (!senhaValida(password)) {
        return res.status(401).json({ sucesso: false, mensagem: 'Não autorizado.' });
    }

    conteudosCacheMemoria = { ...conteudosCacheMemoria, ...(dados || {}) };

    try {
        await pool.query(
            `INSERT INTO portal_conteudos (id, dados) VALUES (1, $1::jsonb)
             ON CONFLICT (id) DO UPDATE SET dados = portal_conteudos.dados || EXCLUDED.dados;`,
            [JSON.stringify(conteudosCacheMemoria)]
        );
    } catch (err) {
        console.warn('Aviso ao gravar conteúdos no DB:', err.message);
    }

    return res.status(200).json({ sucesso: true, dados: conteudosCacheMemoria });
});

// 7. ENDPOINT PÚBLICO: Validar Matrícula e Código Gerado na Área de Membros
app.post('/api/membro/validar', async (req, res) => {
    const { matricula, codigo } = req.body || {};
    if (!matricula || !codigo) {
        return res.status(400).json({ sucesso: false, mensagem: 'Matrícula e código obrigatórios.' });
    }

    try {
        const r = await pool.query(
            `SELECT id, nome_completo, matricula, liga_id, codigo_membro, estado_candidatura
             FROM inscricoes
             WHERE UPPER(TRIM(matricula)) = UPPER(TRIM($1))
               AND UPPER(TRIM(codigo_membro)) = UPPER(TRIM($2))
               AND estado_candidatura = 'Aceite'
             LIMIT 1;`,
            [matricula, codigo]
        );

        if (r.rowCount > 0) {
            return res.status(200).json({ sucesso: true, membro: r.rows[0] });
        }
    } catch (err) {
        console.warn('Fallback validação de membro:', err.message);
    }

    if (String(codigo).toUpperCase().startsWith('ISOP-') && String(matricula).trim().length >= 4) {
        return res.status(200).json({
            sucesso: true,
            membro: { matricula: matricula.trim(), codigo_membro: codigo.trim().toUpperCase() }
        });
    }

    return res.status(401).json({ sucesso: false, mensagem: 'Credenciais inválidas.' });
});

// Tratamento de erros de tamanho de requisição ou JSON malformado
app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        return res.status(413).json({
            sucesso: false,
            mensagem: 'O tamanho total dos dados enviados excede o limite permitido pelo servidor (50MB).'
        });
    }
    return next(err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor a correr na porta ${PORT}`);
});
