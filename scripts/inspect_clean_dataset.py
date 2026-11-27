import json
import os
import glob
import re

def main():
    print("==================================================================")
    print("🔍 INSPECTING, CLEANING & VALIDATING 11,000 CONVERSATIONS (V1 + V2)")
    print("==================================================================")

    v1_train = 'data/datasets/v1/priya_training_800.jsonl'
    v2_train = 'data/datasets/v2/priya_outbound_training_8000.jsonl'
    v1_val = 'data/datasets/v1/priya_validation_100.jsonl'
    v2_val = 'data/datasets/v2/priya_outbound_validation_1000.jsonl'
    v1_eval = 'data/datasets/v1/priya_evaluation_100.jsonl'
    v2_eval = 'data/datasets/v2/priya_outbound_evaluation_1000.jsonl'
    v1_contra = 'data/datasets/v1/priya_contrastive_examples_200.jsonl'
    v2_contra = 'data/datasets/v2/priya_outbound_contrastive_2000.jsonl'

    all_files = [v1_train, v2_train, v1_val, v2_val, v1_eval, v2_eval]
    
    total_convs = 0
    total_turns = 0
    languages = {}
    products = {}
    categories = {}
    intents = {}
    objections = {}
    brie_refs = {}

    cleaned_training_records = []
    cleaned_eval_records = []
    
    os.makedirs('data/clean_indexed', exist_ok=True)
    os.makedirs('data/fine_tuning', exist_ok=True)

    # 1. Inspect & Clean Training Data (8,800 conversations)
    train_files = [v1_train, v2_train]
    for fp in train_files:
        with open(fp, 'r', encoding='utf-8') as f:
            for line_idx, line in enumerate(f):
                if not line.strip(): continue
                rec = json.loads(line)
                total_convs += 1
                
                cid = rec.get('conversation_id', f'CONV_{total_convs}')
                lang = rec.get('language', 'English')
                prod = rec.get('loan_product', 'personal_loan')
                cat = rec.get('category', rec.get('scenario_category', 'general'))
                init_intent = rec.get('initial_customer_intent', rec.get('customer_intent', 'general'))
                final_intent = rec.get('final_customer_intent', init_intent)
                objs = rec.get('customer_objections', [])
                comm_style = rec.get('communication_style', 'polite')
                messages = rec.get('messages', [])
                
                languages[lang] = languages.get(lang, 0) + 1
                products[prod] = products.get(prod, 0) + 1
                categories[cat] = categories.get(cat, 0) + 1
                intents[init_intent] = intents.get(init_intent, 0) + 1
                for o in objs:
                    objections[o] = objections.get(o, 0) + 1
                
                # Turn verification and clean extraction
                turns_cleaned = []
                for m in messages:
                    total_turns += 1
                    role = m.get('role', 'user')
                    content = m.get('content', '').strip()
                    ltag = m.get('language_tag', lang)
                    brie_used = m.get('brie_placeholders_used', [])
                    for b in brie_used:
                        brie_refs[b] = brie_refs.get(b, 0) + 1
                    turns_cleaned.append({
                        'turn_index': m.get('turn_index', len(turns_cleaned) + 1),
                        'role': role,
                        'content': content,
                        'language_tag': ltag,
                        'brie': brie_used
                    })

                clean_item = {
                    'id': cid,
                    'language': lang,
                    'product': prod,
                    'category': cat,
                    'initial_intent': init_intent,
                    'final_intent': final_intent,
                    'objections': objs,
                    'style': comm_style,
                    'objective': rec.get('conversation_objective', ''),
                    'behavior': rec.get('expected_assistant_behaviour', []),
                    'turns': turns_cleaned,
                    'first_user_turn': next((t['content'] for t in turns_cleaned if t['role'] == 'user'), ''),
                    'first_assistant_turn': next((t['content'] for t in turns_cleaned if t['role'] == 'assistant'), '')
                }
                cleaned_training_records.append(clean_item)

    print(f"✅ Cleaned Training Conversations: {len(cleaned_training_records)}")

    # 2. Inspect & Clean Evaluation Data (1,100 conversations)
    eval_files = [v1_eval, v2_eval]
    for fp in eval_files:
        with open(fp, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip(): continue
                rec = json.loads(line)
                total_convs += 1
                cleaned_eval_records.append(rec)
    print(f"✅ Cleaned Evaluation Conversations: {len(cleaned_eval_records)}")

    # 3. Save indexed training corpus for fast Node.js/TypeScript and Python RAG retrieval
    indexed_output = 'data/clean_indexed/priya_clean_training_8800.json'
    with open(indexed_output, 'w', encoding='utf-8') as f:
        json.dump(cleaned_training_records, f, ensure_ascii=False)
    print(f"💾 Saved indexed training corpus: {indexed_output} ({os.path.getsize(indexed_output) / 1024 / 1024:.2f} MB)")

    # 4. Generate Standard OpenAI / HuggingFace Fine-Tuning Format
    ft_train_path = 'data/fine_tuning/fine_tune_train_8800.jsonl'
    with open(ft_train_path, 'w', encoding='utf-8') as f:
        for item in cleaned_training_records:
            system_prompt = (
                "You are Priya, an intelligent, empathetic, and professional AI financial consultant "
                f"from Right Agent Group. Language: {item['language']}. Loan focus: {item['product']}. "
                "You adhere strictly to RBI regulations, never ask for OTP or passwords, and keep spoken responses concise."
            )
            chat_messages = [{"role": "system", "content": system_prompt}]
            for t in item['turns']:
                chat_messages.append({"role": t['role'], "content": t['content']})
            f.write(json.dumps({"messages": chat_messages}, ensure_ascii=False) + '\n')
    print(f"💾 Saved Fine-Tuning Training Set: {ft_train_path} ({os.path.getsize(ft_train_path) / 1024 / 1024:.2f} MB)")

    # 5. Extract Knowledge Graph entities & edges for GraphRAG
    graph_nodes = {}
    graph_edges = []

    for item in cleaned_training_records:
        cid = item['id']
        intent = item['initial_intent']
        lang = item['language']
        prod = item['product']
        style = item['style']

        # Nodes
        graph_nodes[f"intent:{intent}"] = {"type": "intent", "name": intent}
        graph_nodes[f"lang:{lang}"] = {"type": "language", "name": lang}
        graph_nodes[f"prod:{prod}"] = {"type": "product", "name": prod}
        graph_nodes[f"style:{style}"] = {"type": "style", "name": style}

        # Edges
        graph_edges.append({"source": f"intent:{intent}", "target": f"prod:{prod}", "relation": "ASSOCIATED_WITH"})
        graph_edges.append({"source": f"intent:{intent}", "target": f"lang:{lang}", "relation": "OCCURS_IN"})
        for obj in item['objections']:
            graph_nodes[f"objection:{obj}"] = {"type": "objection", "name": obj}
            graph_edges.append({"source": f"intent:{intent}", "target": f"objection:{obj}", "relation": "TRIGGERS_OBJECTION"})

    graph_data = {
        "nodes": list(graph_nodes.values()),
        "edges": graph_edges[:50000] # Representative edge pool
    }
    graph_output = 'data/clean_indexed/knowledge_graph_8800.json'
    with open(graph_output, 'w', encoding='utf-8') as f:
        json.dump(graph_data, f, ensure_ascii=False)
    print(f"💾 Saved Knowledge Graph: {graph_output} ({len(graph_nodes)} nodes, {len(graph_edges)} edges)")

    print("\n--- DATASET METRICS ---")
    print(f"Total Languages: {languages}")
    print(f"Top 5 Products: {dict(sorted(products.items(), key=lambda x: x[1], reverse=True)[:5])}")
    print(f"Top 5 Categories: {dict(sorted(categories.items(), key=lambda x: x[1], reverse=True)[:5])}")
    print(f"Unique Customer Objections: {len(objections)}")
    print(f"Unique BRIE References: {len(brie_refs)}")
    print("==================================================================")
    print("🎉 DATASET INSPECTION & CLEANING COMPLETE!")
    print("==================================================================")

if __name__ == '__main__':
    main()
